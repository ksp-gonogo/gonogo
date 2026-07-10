import {
  DashboardItemContext,
  type MockDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render, waitFor } from "@testing-library/react";
import type React from "react";
import { ThemeProvider } from "styled-components";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "./setupMockDataSource";

/**
 * Per-mode size descriptor consumed by the snapshot helper. Mirrors the
 * `SizeMode` shape in `packages/components/scripts/widgets.ts` so the same
 * mode arrays drive both the playwright PNG renders and the vitest DOM
 * snapshots.
 */
export interface WidgetSnapshotMode {
  name: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

interface Fixture {
  _meta?: unknown;
  [key: string]: unknown;
}

interface SnapshotOpts<Cfg> {
  /** Widget component to mount. */
  Widget: React.ComponentType<{
    config?: Cfg;
    id: string;
    w?: number;
    h?: number;
    onConfigChange?: (next: Cfg) => void;
  }>;
  /** Fixture object — every non-`_`-prefixed key is emitted to the data source. */
  fixture: Fixture;
  /** Grid mode (drives `w`/`h` props and optional per-mode config overlay). */
  mode: WidgetSnapshotMode;
  /** Override the instanceId used by `DashboardItemContext` (rarely needed). */
  instanceId?: string;
  /** Override the default config baseline (config overlay merges on top). */
  defaultConfig?: Cfg;
  /** Forwarded to `setupMockDataSource` — see its own doc comment. Default `false`, matching every existing widget's snapshot behavior. */
  connectSource?: boolean;
}

/**
 * Mount a widget, emit every fixture key onto its data source, and return
 * the stripped innerHTML for snapshotting. Mirrors the playwright probe
 * (`scripts/probe/probe-entry.tsx`) at the DOM level — same mount path,
 * same fixture seeding, same modes — so vitest catches structural
 * regressions while the PNG harness covers the visual layer.
 *
 * The returned HTML has styled-components hashes and testing-library
 * auto-ids stripped so the snapshot is deterministic across runs. Canvas
 * content, ResizeObserver-driven layout, and CSS-paint visuals don't
 * appear — those live in the playwright PNGs.
 */
export async function snapshotWidgetMode<
  Cfg extends Record<string, unknown> = Record<string, unknown>,
>(opts: SnapshotOpts<Cfg>): Promise<string> {
  // The probe registers stock bodies at module load; the DOM snapshot
  // does the same so body-aware widgets see resolved BodyDefinitions
  // for `Kerbin`, `Mun`, etc.
  registerStockBodies();
  const fixtureKeys = Object.keys(opts.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  const fixture = await setupMockDataSource({
    id: "data",
    keys: fixtureKeys.map((key) => ({ key })),
    connectSource: opts.connectSource,
  });
  let source: MockDataSource | null = fixture.source;

  try {
    const config: Cfg = {
      ...(opts.defaultConfig ?? ({} as Cfg)),
      ...((opts.mode.config ?? {}) as Cfg),
    };
    const instanceId = opts.instanceId ?? "snap";
    const { container } = render(
      <ThemeProvider theme={defaultDarkTheme}>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <opts.Widget
            config={config}
            id={instanceId}
            w={opts.mode.w}
            h={opts.mode.h}
          />
        </DashboardItemContext.Provider>
      </ThemeProvider>,
    );

    // Seed every fixture key after mount so useDataValue subscriptions
    // exist before the emits — matches the probe's "mount, then emit"
    // ordering. Without the act() wrapper React batches updates and the
    // snapshot races the commit.
    act(() => {
      for (const key of fixtureKeys) {
        source?.emit(key, opts.fixture[key]);
      }
    });

    // Drain the async `useDataSeries` backfill (graphs/sparklines) before
    // snapshotting. waitFor wraps act, so the backfill's notify() flushes
    // inside it — no manual act(). Waits on the real pending work, not a
    // bare tick. No-op for widgets that never query a range.
    await waitFor(() => {
      if (fixture.pendingQueries() !== 0) throw new Error("backfill pending");
    });

    return stripVolatile(container.innerHTML);
  } finally {
    teardownMockDataSource(fixture);
    source = null;
  }
}

/** Live render handle from {@link renderWidgetMode}. */
export interface RenderedWidget {
  /** The mounted, still-live container — valid until `teardown()`. */
  container: HTMLElement;
  /**
   * Unmount and disconnect. Must be called by the test (typically right
   * after assertions). Runs `cleanup()` before the data-source disconnect
   * so no state update fires outside `act()`.
   */
  teardown: () => void;
}

/**
 * Mount a widget exactly like {@link snapshotWidgetMode} — same registry,
 * same fixture seeding, same context — but leave it mounted and return the
 * live `container` plus a `teardown()`, for callers that need to assert on
 * the rendered DOM (e.g. running `axe()` for an a11y smoke). Unlike
 * `snapshotWidgetMode`, teardown is the caller's responsibility: run your
 * assertions against `container` first, then call `teardown()`.
 */
export async function renderWidgetMode<
  Cfg extends Record<string, unknown> = Record<string, unknown>,
>(opts: SnapshotOpts<Cfg>): Promise<RenderedWidget> {
  registerStockBodies();
  const fixtureKeys = Object.keys(opts.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  const fixture = await setupMockDataSource({
    id: "data",
    keys: fixtureKeys.map((key) => ({ key })),
    connectSource: opts.connectSource,
  });
  const source: MockDataSource = fixture.source;

  const config: Cfg = {
    ...(opts.defaultConfig ?? ({} as Cfg)),
    ...((opts.mode.config ?? {}) as Cfg),
  };
  const instanceId = opts.instanceId ?? "snap";
  const { container } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <opts.Widget
          config={config}
          id={instanceId}
          w={opts.mode.w}
          h={opts.mode.h}
        />
      </DashboardItemContext.Provider>
    </ThemeProvider>,
  );

  act(() => {
    for (const key of fixtureKeys) {
      source.emit(key, opts.fixture[key]);
    }
  });

  // Drain the async useDataSeries backfill the testing-library way (see
  // snapshotWidgetMode) so a11y assertions run against a settled tree.
  await waitFor(() => {
    if (fixture.pendingQueries() !== 0) throw new Error("backfill pending");
  });

  return { container, teardown: () => teardownMockDataSource(fixture) };
}

/**
 * Strip styled-components hashes, testing-library auto-ids, and any
 * `sc-*` class/id attributes that change per build. Without this the
 * snapshot churns on every styled-components release / file edit.
 */
/**
 * Exported (beyond this file's own two internal callers) for the M3
 * behavior-preservation golden dual-run (`WarpControl/dual-run.test.tsx`) —
 * comparing a legacy render against a stream render needs the exact same
 * styled-components-hash/testid stripping this file already does, so a
 * genuine markup difference isn't masked by two builds' differing
 * volatile-class churn.
 */
export function stripVolatile(html: string): string {
  return html
    .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]+"/g, "")
    .replace(/\sdata-sc[a-z-]*="[^"]*"/g, "");
}
