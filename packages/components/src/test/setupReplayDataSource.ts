import {
  clearActionHandlers,
  clearRegistry,
  registerDataSource,
} from "@gonogo/core";
import {
  BufferedDataSource,
  type FlightFixture,
  FlightReplayDataSource,
  MemoryStore,
} from "@gonogo/data";
import { cleanup } from "@testing-library/react";

export interface SetupReplayOptions {
  fixture: FlightFixture;
  /** Defaults to "data" so widgets reading via `useDataValue("data", ...)` find it. */
  id?: string;
  /** Mirror real telemetry for `BufferedDataSource`'s signal-gate behaviour. */
  affectedBySignalLoss?: boolean;
  /** Connect the buffered layer before resolving. Defaults to `true`. */
  connect?: boolean;
}

export interface ReplayDataSourceFixture {
  /** The replay source — call `advance(ms)` / `seek(ms)` to drive samples. */
  replay: FlightReplayDataSource;
  /** The registered buffered wrapper — what components see via `useDataValue`. */
  buffered: BufferedDataSource;
}

/**
 * Sibling of `setupMockDataSource` that wires a `FlightReplayDataSource`
 * through the standard `BufferedDataSource` instead of `MockDataSource`.
 * Use this for widget tests where you'd rather drive a whole flight than
 * fake individual key emissions.
 *
 * Pattern:
 * ```ts
 * const fixture = synthesizeFlight({ ... });
 * const setup = await setupReplayDataSource({ fixture });
 * render(<Widget ... />);
 * setup.replay.advance(setup.replay.duration());
 * ```
 *
 * The buffered wrapper is registered (not the raw replay source) so the
 * widget's `useDataSeries` hook works — it depends on BufferedDataSource's
 * `queryRange` / `subscribeSamples` extensions.
 */
export async function setupReplayDataSource(
  opts: SetupReplayOptions,
): Promise<ReplayDataSourceFixture> {
  clearRegistry();
  const replay = new FlightReplayDataSource({
    fixture: opts.fixture,
    id: opts.id,
    affectedBySignalLoss: opts.affectedBySignalLoss,
  });
  const buffered = new BufferedDataSource({
    source: replay,
    store: new MemoryStore(),
  });
  registerDataSource(buffered);
  if (opts.connect ?? true) {
    await replay.connect();
    await buffered.connect();
  }
  return { replay, buffered };
}

/**
 * Mirror of `teardownMockDataSource` — cleanup first, then disconnect both
 * layers, so the buffered wrapper's status-disconnect callbacks don't fire
 * inside still-mounted components and trigger out-of-act state updates.
 */
export function teardownReplayDataSource(
  fixture: ReplayDataSourceFixture,
): void {
  cleanup();
  fixture.buffered.disconnect();
  fixture.replay.disconnect();
  clearActionHandlers();
}
