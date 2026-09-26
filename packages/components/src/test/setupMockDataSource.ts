import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearRegistry,
  getComponents,
  getThemes,
  registerComponent,
  registerDataSource,
  registerTheme,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { cleanup } from "@ksp-gonogo/test-utils";

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
  /**
   * Also connect the raw upstream `MockDataSource` (default `false`), for a
   * test that reads `.status` off the source and needs `"connected"`.
   * `emit()` delivery does not need it.
   */
  connectSource?: boolean;
}

export interface MockDataSourceFixture {
  /** The raw in-memory source: call `emit(key, value)` to push samples. */
  source: MockDataSource;
  /** The registered buffered wrapper, which components read through. */
  buffered: BufferedDataSource;
  /**
   * Number of `queryRange` backfills still in flight, so a test can
   * `await waitFor(() => expect(fixture.pendingQueries()).toBe(0))` and flush
   * the `useDataSeries` notify inside act. 0 for widgets that never query.
   */
  pendingQueries: () => number;
}

/**
 * Reset the data-source registry and put back the component and theme
 * registries `clearRegistry` also empties: widget modules register their
 * component once, at import. The sdk publishes no per-registry clear.
 */
function clearOnlyDataSources(): void {
  const components = getComponents();
  const themes = getThemes();
  clearRegistry();
  for (const def of components) {
    registerComponent(def as Parameters<typeof registerComponent>[0]);
  }
  for (const theme of themes) registerTheme(theme);
}

/**
 * Stand up the `clearRegistry`, `MockDataSource`, `BufferedDataSource`,
 * `registerDataSource`, `connect()` pattern. The buffered wrapper is what is
 * registered, since components read through it in production.
 */
export async function setupMockDataSource(
  opts: SetupMockOptions,
): Promise<MockDataSourceFixture> {
  clearOnlyDataSources();
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

  // Counts in-flight backfills without touching the production BufferedDataSource.
  let pending = 0;
  const realQueryRange = buffered.queryRange.bind(buffered);
  buffered.queryRange = (...args: Parameters<typeof realQueryRange>) => {
    pending++;
    return realQueryRange(...args).finally(() => {
      pending--;
    });
  };

  registerDataSource(buffered);
  if (opts.connect ?? true) {
    await buffered.connect();
  }
  if (opts.connectSource) {
    await source.connect();
  }
  return { source, buffered, pendingQueries: () => pending };
}

/**
 * Mirror of the standard widget-test `afterEach`: `cleanup()` unmounts
 * before disconnect, so no status change re-renders a mounted tree.
 */
export function teardownMockDataSource(fixture: MockDataSourceFixture): void {
  cleanup();
  fixture.buffered.disconnect();
  clearActionHandlers();
}
