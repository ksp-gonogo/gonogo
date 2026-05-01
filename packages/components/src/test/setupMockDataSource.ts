import type { DataKey } from "@gonogo/core";
import {
  clearActionHandlers,
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { cleanup } from "@testing-library/react";

export interface SetupMockOptions {
  /** Schema keys exposed by the mock source. */
  keys: DataKey[];
  /** Source id. Defaults to `"mock"` (the `MockDataSource` default). */
  id?: string;
  /** Mirror real telemetry for `BufferedDataSource`'s signal-gate behaviour. */
  affectedBySignalLoss?: boolean;
  /** Spy/handler for `execute()` calls on the underlying source. */
  onExecute?: (action: string) => void | Promise<void>;
  /** Connect the buffered layer before resolving. Defaults to `true`. */
  connect?: boolean;
}

export interface MockDataSourceFixture {
  /** The raw in-memory source — call `emit(key, value)` to push samples. */
  source: MockDataSource;
  /** The registered buffered wrapper — what components see via `useDataValue`. */
  buffered: BufferedDataSource;
}

/**
 * Stand up the `clearRegistry → MockDataSource → BufferedDataSource →
 * registerDataSource → connect()` pattern that ~10 widget tests duplicate.
 *
 * Faithfully reproduces the existing setup (e.g. `ManeuverPlanner`,
 * `CurrentOrbit`, `CommSignal`, `ScienceBench`, `DistanceToTarget`,
 * `TargetPicker`, `CrewManifest`):
 *
 * ```ts
 * clearRegistry();
 * source = new MockDataSource({ keys, affectedBySignalLoss });
 * buffered = new BufferedDataSource({ source, store: new MemoryStore() });
 * registerDataSource(buffered);
 * await buffered.connect();
 * ```
 *
 * The buffered wrapper is registered (not the raw source) — components read
 * through the buffered layer in production, so tests must too.
 */
export async function setupMockDataSource(
  opts: SetupMockOptions,
): Promise<MockDataSourceFixture> {
  clearRegistry();
  const source = new MockDataSource({
    id: opts.id,
    keys: opts.keys,
    affectedBySignalLoss: opts.affectedBySignalLoss,
    onExecute: opts.onExecute,
  });
  const buffered = new BufferedDataSource({
    source,
    store: new MemoryStore(),
  });
  registerDataSource(buffered);
  if (opts.connect ?? true) {
    await buffered.connect();
  }
  return { source, buffered };
}

/**
 * Mirror of the standard widget-test `afterEach`:
 *
 * ```ts
 * cleanup();
 * buffered.disconnect();
 * clearActionHandlers();
 * ```
 *
 * Order matters — `cleanup()` unmounts before disconnect to avoid `act()`
 * warnings from state updates triggered by a status change while a component
 * is still mounted (see CLAUDE.md → Testing Philosophy).
 */
export function teardownMockDataSource(fixture: MockDataSourceFixture): void {
  cleanup();
  fixture.buffered.disconnect();
  clearActionHandlers();
}
