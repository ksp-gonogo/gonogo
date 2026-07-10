import { getDataSource, registerDataSource } from "@ksp-gonogo/core";
import {
  BufferedDataSource,
  IndexedDbStore,
  registerBuiltinDerivedKeys,
} from "@ksp-gonogo/data";
import type { KosDataSource } from "./kos";
import { telemachusSource } from "./telemachus";

registerBuiltinDerivedKeys();

/**
 * Wraps the raw telemachus source in a flight-aware, IndexedDB-backed
 * buffer and registers it under id `data`. Widgets that want history
 * (graphs, future push-to-main replays) subscribe through this; raw
 * `telemachus`/`kos` stays registered for callers that genuinely want
 * live-only access (kOS terminal, debug overlays).
 *
 * Connecting is the caller's job — MainScreen calls
 * `bufferedDataSource.connect()` alongside the other sources.
 */
export const bufferedDataSource = new BufferedDataSource({
  source: telemachusSource,
  store: new IndexedDbStore(),
});

registerDataSource(bufferedDataSource);

/**
 * Wire the kOS centralised-compute fanout into the buffered store so
 * `kos.compute.<topic>.<field>` samples land in the flight history
 * alongside Telemachus telemetry. Captured samples are then included in
 * the exported FlightFixture and play back through `ReplayController` as
 * if they were Telemachus keys.
 *
 * Called from the app entry (`main.tsx`) after both sources are
 * registered. Idempotent — safe to call more than once; the latest
 * sink wins.
 */
export function attachKosCaptureToBuffered(): void {
  const kos = getDataSource("kos") as KosDataSource | undefined;
  if (!kos) return;
  kos.setSampleSink((key, value) => {
    bufferedDataSource.appendExternalSample(key, value);
  });
  // Publish the kOS schema so `schema()` consumers (data picker,
  // exportFlight) see kOS keys alongside Telemachus + derived keys.
  // Schema is dynamic but settles at module load — registering once
  // covers the built-in scripts (ShipMap, KosProcessors, TargetPicker
  // vessel list). HMR-loaded scripts won't backfill into older fixtures.
  bufferedDataSource.registerExternalKeys(
    kos.schema().map((k) => ({
      key: k.key,
      label: k.description ?? k.key,
      group: "kOS",
    })),
  );
}
