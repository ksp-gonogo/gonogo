import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearRegistry,
  getComponents,
  getThemes,
  MockDataSource,
  registerComponent,
  registerDataSource,
  registerTheme,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
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
   * Also connect the RAW upstream `MockDataSource` (default `false`,
   * preserving the existing convention documented in
   * `setupMockDataSource.test.ts`: "the shared pattern doesn't connect the
   * upstream MockDataSource... status remains disconnected"). Opt in for a
   * widget test whose rendered output reads `.status`/`onStatusChange`
   * directly off the "data" source (e.g. via `useDataStreamStatus`) and
   * needs it to genuinely read `"connected"`, matching what a live
   * production `DataSource` would report during normal data flow,
   * `emit()`-driven value delivery already works without this (subscription
   * is map-based, not status-gated), so most widget tests don't need it.
   */
  connectSource?: boolean;
}

export interface MockDataSourceFixture {
  /** The raw in-memory source: call `emit(key, value)` to push samples. */
  source: MockDataSource;
  /** The registered buffered wrapper: what components see via `useDataValue`. */
  buffered: BufferedDataSource;
  /**
   * Number of `queryRange` backfills still in flight. `useDataSeries`
   * (graphs, sparklines) fires an async `queryRange().then(notify)` on
   * mount; its `notify()` would otherwise land outside `act()`. Tests/
   * harnesses await this settling the testing-library way,
   * `await waitFor(() => expect(fixture.pendingQueries()).toBe(0))`: so the
   * backfill update is flushed inside waitFor's act-wrapping (rather than a
   * manual `act()`). Returns 0 for widgets that never query a range.
   */
  pendingQueries: () => number;
}

/**
 * Stand up the `clearRegistry → MockDataSource → BufferedDataSource →
 * registerDataSource → connect()` pattern that ~10 widget tests duplicate.
 *
 * Faithfully reproduces the existing setup (e.g. `ManeuverPlanner`,
 * `CurrentOrbit`, `CommSignal`, `ScienceBench`, `Targeting`,
 * `TargetPicker`, `CrewStatus`):
 *
 * ```ts
 * clearRegistry();
 * source = new MockDataSource({ keys, affectedBySignalLoss });
 * buffered = new BufferedDataSource({ source, store: new MemoryStore() });
 * registerDataSource(buffered);
 * await buffered.connect();
 * ```
 *
 * The buffered wrapper is registered (not the raw source), components read
 * through the buffered layer in production, so tests must too.
 */
/**
 * Reset the data-source registry and put back the two registries this helper
 * does not own.
 *
 * `clearRegistry` empties components, data sources and themes together, and
 * this helper wants only the middle one. Widget modules register their
 * component ONCE, at import, so from the second `setupMockDataSource` call in a
 * file onward the component registry was empty for the rest of the run:
 * `widgetDomSnapshot` had to cache each widget's registered `defaultConfig` by
 * component identity to survive it, and any test reaching the registry after
 * its first render saw nothing there.
 *
 * Restoring is a stand-in for the narrower clear. The registries live in
 * `@ksp-gonogo/sitrep-sdk`, which publishes `clearRegistry` and no per-registry
 * equivalent, and a leaf package every Uplink depends on is not somewhere to
 * add an export in passing.
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

  // Track in-flight `queryRange` backfills so tests can await them settling
  // (see MockDataSourceFixture.pendingQueries). Wrapping here keeps the
  // production BufferedDataSource untouched: this is purely a test seam.
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
 * Mirror of the standard widget-test `afterEach`:
 *
 * ```ts
 * cleanup();
 * buffered.disconnect();
 * clearActionHandlers();
 * ```
 *
 * Order matters, `cleanup()` unmounts before disconnect to avoid `act()`
 * warnings from state updates triggered by a status change while a component
 * is still mounted (see CLAUDE.md → Testing Philosophy).
 */
export function teardownMockDataSource(fixture: MockDataSourceFixture): void {
  cleanup();
  fixture.buffered.disconnect();
  clearActionHandlers();
}
