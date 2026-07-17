import type { VesselTopology } from "@ksp-gonogo/core";
import {
  DashboardItemContext,
  type MockDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";

import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import type React from "react";
import { Fragment } from "react";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "./setupMockDataSource";
import { setupStreamFixture } from "./setupStreamFixture";
import {
  extractLegacyPartLiveFromFixture,
  topologyToVesselPartsWire,
} from "./topologyToVesselPartsWire";

/**
 * Fixtures authored before the `t.universalTime` client migration
 * (`useDataValue("data", "t.universalTime")` → `useViewUt()`) still carry a
 * `"t.universalTime"` key — it's harmless to leave (widgets that don't read
 * it just ignore the emit), but a migrated widget's `useViewUt()` needs a
 * mounted `TelemetryProvider` to resolve to anything at all. Pin one from
 * the fixture's own value so these fixtures keep rendering exactly as they
 * did when the read came straight off the legacy `DataSource` — no
 * per-fixture/per-test opt-in needed. Fixtures with no such key are
 * unaffected (`pinnedUt` stays `undefined`, no `TelemetryProvider` mounted).
 */
function resolvePinnedUt(fixture: Fixture): number | undefined {
  const raw = fixture["t.universalTime"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Same story as {@link resolvePinnedUt}, for the `v.topology`/`v.topologySeq`
 * retirement: `useTopology` (ShipMap/PowerSystems) now reads `vessel.parts`
 * canonically with NO legacy fallback at all, so a ShipMap/PowerSystems
 * fixture that still carries a `v.topology` payload (every existing fixture
 * does — captured before this migration) needs it reshaped onto the wire
 * shape and streamed through the SAME mounted `TelemetryProvider`, or the
 * "legacy" snapshot leg would render nothing but the "Waiting for vessel
 * topology..." empty state. Fixtures with no `v.topology` key are unaffected.
 *
 * Also overlays any `r.resourceFor[fid]`/`v.partState[fid]` legacy keys the
 * fixture carries — `usePartsLive`'s per-part `resources`/`partState` join
 * rides this SAME `vessel.parts` payload now (no more legacy `DataSource`
 * subscription), so a PowerSystems fixture with those keys (e.g.
 * `03-solar-charging-sunlight`) needs them folded in here or the "legacy"
 * leg would render an empty Producers/Consumers list instead of the
 * fixture's real PROD/NET numbers.
 */
function resolveVesselPartsWire(fixture: Fixture): unknown {
  const raw = fixture["v.topology"];
  if (!raw || typeof raw !== "object") return undefined;
  return topologyToVesselPartsWire(
    raw as VesselTopology,
    extractLegacyPartLiveFromFixture(fixture),
  );
}

/**
 * Same story as {@link resolvePinnedUt}/{@link resolveVesselPartsWire}, for the
 * `ActionGroup` canonical-read migration: that widget dropped its legacy
 * `useDataValue("data", group.value)` shim entirely and now reads
 * `vessel.control` / `vessel.structure` one-arg, so a fixture carrying the old
 * `v.sasValue`/`v.ag1Value`/… keys needs them reshaped onto the wire or the
 * widget would render "—" for every group instead of the fixture's real state.
 *
 * Reshapes only the keys a fixture actually carries: an absent key stays absent
 * (`undefined`), which is the contract's own "not available this tick" and
 * exactly what the `unknown-state` fixture is asserting. Custom groups are
 * rebuilt as the NAMED list the mod now sends, sourced from whichever
 * `v.ag{n}Value` keys are present.
 */
function resolveVesselControlWire(fixture: Fixture): unknown {
  const bool = (key: string): boolean | undefined =>
    typeof fixture[key] === "boolean" ? (fixture[key] as boolean) : undefined;

  const actionGroups: { index: number; name: string; state: boolean }[] = [];
  for (let i = 1; i <= 10; i++) {
    const state = bool(`v.ag${i}Value`);
    if (state !== undefined) {
      actionGroups.push({ index: i, name: `AG${i}`, state });
    }
  }

  const control: Record<string, unknown> = {
    sas: bool("v.sasValue"),
    rcs: bool("v.rcsValue"),
    gear: bool("v.gearValue"),
    brakes: bool("v.brakeValue"),
    lights: bool("v.lightValue"),
    abort: bool("v.abortValue"),
    precisionControl: bool("v.precisionControlValue"),
    actionGroups: actionGroups.length > 0 ? actionGroups : undefined,
  };

  // Nothing this widget reads => no payload at all, so the provider isn't
  // mounted for fixtures that have nothing to say about control state.
  return Object.values(control).some((v) => v !== undefined)
    ? control
    : undefined;
}

/** `v.currentStage` -> `vessel.structure.currentStage` — ActionGroup's "Stage" group. */
function resolveVesselStructureWire(fixture: Fixture): unknown {
  const raw = fixture["v.currentStage"];
  return typeof raw === "number" ? { currentStage: raw } : undefined;
}

/**
 * `t.isPaused` -> `time.warp.paused` — the same story as
 * {@link resolveVesselControlWire}, for the OTHER canonical-read migration that
 * landed on these widgets: the pause/no-signal unavailability notices read
 * `time.warp` / `comms.link` one-arg now, with no legacy fallback, so a fixture
 * carrying the old keys must reshape them onto the wire or the notice silently
 * never renders. Absent key stays absent.
 */
function resolveTimeWarpWire(fixture: Fixture): unknown {
  const raw = fixture["t.isPaused"];
  return typeof raw === "boolean" ? { paused: raw } : undefined;
}

/** `comm.connected` -> `comms.link.connected` — see {@link resolveTimeWarpWire}. */
function resolveCommsLinkWire(fixture: Fixture): unknown {
  const raw = fixture["comm.connected"];
  return typeof raw === "boolean" ? { connected: raw } : undefined;
}

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

/** Built once per snapshot render — see {@link buildStreamWrap}. */
interface StreamWrap {
  /** Wraps `children` in the `TelemetryProvider` this fixture built, or renders them untouched when neither `pinnedUt` nor a `vessel.parts` payload is needed. */
  Wrap: (props: { children: React.ReactNode }) => React.ReactElement;
  /** `true` when a `TelemetryProvider` was actually mounted — drives {@link flushProviderFrame}. */
  providerMounted: boolean;
  /** Emits the fixture's `v.topology` (reshaped) onto `vessel.parts`, or a no-op when the fixture carries no `v.topology`. Call inside the same `act()` block as the other fixture-key emits. */
  emitVesselParts: () => void;
  /** Emits the fixture's legacy control keys (reshaped) onto `vessel.control`/`vessel.structure`, or a no-op when it carries none. Same `act()` block as the other emits. */
  emitVesselControl: () => void;
}

/**
 * Builds the minimal `TelemetryProvider` a legacy-fixture snapshot needs for
 * the two migrations that dropped their legacy fallback entirely:
 * `useViewUt()` (pinned at `pinnedUt`, see {@link resolvePinnedUt}) and
 * `useTopology()` (fed `vessel.parts`, see {@link resolveVesselPartsWire}).
 * Nothing else is carried — every other read stays on the legacy
 * `DataSource`. Returns a pass-through `Wrap` (no provider at all) when
 * neither is needed, matching every widget that touches neither key.
 */
function buildStreamWrap(fixture: Fixture): StreamWrap {
  const pinnedUt = resolvePinnedUt(fixture);
  const vesselPartsWire = resolveVesselPartsWire(fixture);
  const vesselControlWire = resolveVesselControlWire(fixture);
  const vesselStructureWire = resolveVesselStructureWire(fixture);
  const timeWarpWire = resolveTimeWarpWire(fixture);
  const commsLinkWire = resolveCommsLinkWire(fixture);
  if (
    pinnedUt === undefined &&
    vesselPartsWire === undefined &&
    vesselControlWire === undefined &&
    vesselStructureWire === undefined &&
    timeWarpWire === undefined &&
    commsLinkWire === undefined
  ) {
    return {
      Wrap: ({ children }) => <Fragment>{children}</Fragment>,
      providerMounted: false,
      emitVesselParts: () => {},
      emitVesselControl: () => {},
    };
  }
  // `time.warp`/`comms.link` must be CARRIED, not merely emitted: the pause and
  // no-signal notices read them one-arg off the stream, and an uncarried channel
  // never reaches the widget. The other payloads here predate that distinction.
  const carriedChannels: string[] = [];
  if (timeWarpWire !== undefined) carriedChannels.push("time.warp");
  if (commsLinkWire !== undefined) carriedChannels.push("comms.link");
  const stream = setupStreamFixture({ carriedChannels, pinnedUt });
  return {
    Wrap: stream.Provider,
    providerMounted: true,
    emitVesselParts: () => {
      if (vesselPartsWire !== undefined) {
        stream.emit("vessel.parts", vesselPartsWire);
      }
    },
    emitVesselControl: () => {
      if (vesselControlWire !== undefined) {
        stream.emit("vessel.control", vesselControlWire);
      }
      if (vesselStructureWire !== undefined) {
        stream.emit("vessel.structure", vesselStructureWire);
      }
      if (timeWarpWire !== undefined) {
        stream.emit("time.warp", timeWarpWire);
      }
      if (commsLinkWire !== undefined) {
        stream.emit("comms.link", commsLinkWire);
      }
    },
  };
}

/**
 * `useViewUt()`'s scrubbed value only lands via `ViewClock.onFrame`'s
 * `requestAnimationFrame` loop (its synchronous initial seed reads
 * `confirmedEdgeUt()`, which ignores `scrubTo` entirely — see that hook's
 * own doc comment in `sitrep-client/src/context.tsx`), and `useTopology`'s
 * canonical stream read similarly only lands via the `TelemetryProvider`'s
 * `beginFrame()` scheduling (a `requestAnimationFrame`, falling back to a
 * microtask under jsdom). Either way a plain `render()` + `act()` can commit
 * BEFORE the value has actually reached React state. Flush two rAF ticks
 * (wrapped in `act` so the resulting re-render doesn't warn) before reading
 * the DOM whenever a `TelemetryProvider` was mounted for this render — a
 * no-op when {@link StreamWrap.providerMounted} is `false`.
 */
async function flushProviderFrame(providerMounted: boolean): Promise<void> {
  if (!providerMounted) return;
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
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
    const { Wrap, providerMounted, emitVesselParts, emitVesselControl } =
      buildStreamWrap(opts.fixture);
    const { container } = render(
      <Wrap>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <opts.Widget
            config={config}
            id={instanceId}
            w={opts.mode.w}
            h={opts.mode.h}
          />
        </DashboardItemContext.Provider>
      </Wrap>,
    );

    // Seed every fixture key after mount so useDataValue subscriptions
    // exist before the emits — matches the probe's "mount, then emit"
    // ordering. Without the act() wrapper React batches updates and the
    // snapshot races the commit.
    act(() => {
      for (const key of fixtureKeys) {
        source?.emit(key, opts.fixture[key]);
      }
      emitVesselParts();
      emitVesselControl();
    });
    await flushProviderFrame(providerMounted);

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
  const { Wrap, providerMounted, emitVesselParts, emitVesselControl } =
    buildStreamWrap(opts.fixture);
  const { container } = render(
    <Wrap>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <opts.Widget
          config={config}
          id={instanceId}
          w={opts.mode.w}
          h={opts.mode.h}
        />
      </DashboardItemContext.Provider>
    </Wrap>,
  );

  act(() => {
    for (const key of fixtureKeys) {
      source.emit(key, opts.fixture[key]);
    }
    emitVesselParts();
    emitVesselControl();
  });
  await flushProviderFrame(providerMounted);

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
 * Exported (beyond this file's own two internal callers) for the
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
