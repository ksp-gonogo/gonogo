import {
  type BodyDefinition,
  registerFogRevealSource,
  useFogMaskCache,
  useLateTelemetrySubscribe,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import { SCAN_TYPE, type SCANCoverageBitmap, type SCANType } from "../schema";
import { applyScanCoverageToMask } from "./scanCoverageSync";

/**
 * Scan types this Uplink keeps per-body fog masks for, mapped to their
 * `"scansat:<Name>"` reveal-source layerId (the `<uplinkId>:<name>`
 * convention every Uplink's fog reveal sources follow) and composite
 * weight. Higher-resolution scans within a channel (HiRes vs LoRes) get
 * a brighter weight so MapView's paint-gate reveals more for a
 * HiRes-covered tile than a LoRes-only one.
 *
 * Visual (LoRes/HiRes) and Anomaly are deliberately excluded:
 *   - Visual* are deprecated in modern KSP / SCANsat — no stock parts emit
 *     them.
 *   - Anomaly markers are surfaced via `scansat.anomalies.body` directly
 *     (point-based, not area-based fog).
 */
const FOG_SCAN_TYPES: readonly {
  type: SCANType;
  layerId: string;
  weight: number;
}[] = [
  {
    type: SCAN_TYPE.AltimetryLoRes,
    layerId: "scansat:AltimetryLoRes",
    weight: 192,
  },
  {
    type: SCAN_TYPE.AltimetryHiRes,
    layerId: "scansat:AltimetryHiRes",
    weight: 255,
  },
  { type: SCAN_TYPE.Biome, layerId: "scansat:Biome", weight: 255 },
  {
    type: SCAN_TYPE.ResourceLoRes,
    layerId: "scansat:ResourceLoRes",
    weight: 192,
  },
  {
    type: SCAN_TYPE.ResourceHiRes,
    layerId: "scansat:ResourceHiRes",
    weight: 255,
  },
];

// Register at module load — same lifecycle as registerComponent/
// registerAugment elsewhere in this Uplink's client. Side-effected via the
// bare `import "./FogReveal/useScanSatFogSync"` in this package's index.ts.
for (const { layerId, weight } of FOG_SCAN_TYPES) {
  registerFogRevealSource({ id: layerId, weight });
}

/**
 * Subscribe to one `scansat.mask.body.scanType` per relevant scan
 * type and merge each push into its own per-type fog mask. SCANsat's
 * coverage is per-program (cross-vessel, persists with the save), so
 * each per-type mask reflects the union of every scanner of that type
 * that has ever flown over the body.
 */
export function useScanSatFogSync(
  body: BodyDefinition | undefined,
  dataSourceId = "data",
): void {
  const scanAvailable = useTelemetry<boolean>(
    dataSourceId,
    "scansat.available",
  );
  const cache = useFogMaskCache();
  const subscribe = useLateTelemetrySubscribe();

  useEffect(() => {
    if (!scanAvailable) return;
    if (!body || !cache) return;

    // Guards the acquire race: `cache.acquire` resolves on a later
    // microtask, so a `body`/`cache` change (or unmount) that fires this
    // effect's cleanup before that resolves must stop the callback from
    // subscribing at all, not just from writing into a stale mask.
    // Subscriptions that DID make it through are torn down by
    // `useLateTelemetrySubscribe` itself, on this hook's owner unmounting.
    let cancelled = false;

    // Eagerly acquire each per-type mask so the subscribe handler can
    // write into a real buffer the first time SCANsat pushes a frame.
    // Without the acquire, the cache has no entry → markDirty no-ops →
    // the first push silently drops on the floor.
    for (const { type: scanType, layerId } of FOG_SCAN_TYPES) {
      void cache.acquire(body.id, layerId).then((mask) => {
        if (cancelled) return;
        const key = `scansat.mask.${body.name}.${scanType}`;
        subscribe<unknown>(key, (value) => {
          if (!value || typeof value !== "object") return;
          const bitmap = value as Partial<SCANCoverageBitmap>;
          if (
            typeof bitmap.width !== "number" ||
            typeof bitmap.height !== "number" ||
            typeof bitmap.bits !== "string"
          ) {
            return;
          }
          const changed = applyScanCoverageToMask(
            bitmap as SCANCoverageBitmap,
            mask,
            body,
          );
          if (changed) cache.markDirty(body.id, layerId);
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [scanAvailable, body, cache, subscribe]);
}
