import {
  clearActionHandlers,
  clearRegistry,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  BufferedDataSource,
  type FlightFixture,
  FlightReplayDataSource,
  MemoryStore,
} from "@ksp-gonogo/data";
import { act, cleanup } from "@testing-library/react";

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

/**
 * Advance the replay clock sample-by-sample, with each sample fired inside
 * its own `act()` scope. Two reasons for the per-step boundary:
 *
 * 1. State updates land inside scope (no out-of-act warnings).
 * 2. React's effect cycle fully drains between samples, so widgets whose
 *    behaviour depends on the *sequence* of inputs (mode transitions in
 *    DistanceToTarget, alarm latching, etc.) see every intermediate state
 *    instead of having multiple emits batched into one render.
 *
 * Use in widget integration tests:
 *
 * ```ts
 * await stepwise(fixture, 5_000);
 * expect(await screen.findByText(...)).toBeInTheDocument();
 * ```
 */
export async function stepwise(
  fixture: ReplayDataSourceFixture,
  dt: number,
): Promise<void> {
  if (dt <= 0) return;
  const targetT = fixture.replay.now() + dt;
  // Walk one pending sample at a time, each inside its own act() so
  // React's commit + effect cycle drains before the next sample fires.
  while (true) {
    const next = fixture.replay.nextPendingSampleT();
    if (next === null || next > targetT) break;
    await act(async () => {
      fixture.replay.seek(next);
    });
  }
  // Land exactly on `targetT` even when no sample sits there — keeps
  // currentT consistent with what the caller asked for.
  if (fixture.replay.now() < targetT) {
    await act(async () => {
      fixture.replay.seek(targetT);
    });
  }
}
