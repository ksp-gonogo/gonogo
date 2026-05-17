import {
  DashboardItemContext,
  type MockDataSource,
  registerStockBodies,
} from "@gonogo/core";
import type { BufferedDataSource } from "@gonogo/data";
import { act, render } from "@testing-library/react";
import type React from "react";
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
  });
  let source: MockDataSource | null = fixture.source;
  let buffered: BufferedDataSource | null = fixture.buffered;

  try {
    const config: Cfg = {
      ...(opts.defaultConfig ?? ({} as Cfg)),
      ...((opts.mode.config ?? {}) as Cfg),
    };
    const instanceId = opts.instanceId ?? "snap";
    const { container } = render(
      <DashboardItemContext.Provider value={{ instanceId }}>
        <opts.Widget
          config={config}
          id={instanceId}
          w={opts.mode.w}
          h={opts.mode.h}
        />
      </DashboardItemContext.Provider>,
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

    return stripVolatile(container.innerHTML);
  } finally {
    teardownMockDataSource({
      source: source as MockDataSource,
      buffered: buffered as BufferedDataSource,
    });
    source = null;
    buffered = null;
  }
}

/**
 * Strip styled-components hashes, testing-library auto-ids, and any
 * `sc-*` class/id attributes that change per build. Without this the
 * snapshot churns on every styled-components release / file edit.
 */
function stripVolatile(html: string): string {
  return html
    .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]+"/g, "")
    .replace(/\sdata-sc[a-z-]*="[^"]*"/g, "");
}
