import type { ComponentProps, VesselTopology } from "@ksp-gonogo/core";
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponents,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import type { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import type React from "react";
import { Fragment } from "react";
import { applyInstallProfile, getInstallProfile } from "./installProfile";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "./setupMockDataSource";
import { fixtureEmitsMuted, setupStreamFixture } from "./setupStreamFixture";
import {
  extractLegacyPartLiveFromFixture,
  topologyToVesselPartsWire,
} from "./topologyToVesselPartsWire";

/**
 * A legacy fixture's `"t.universalTime"` key pins the view clock, since
 * `useViewUt()` resolves only under a mounted `TelemetryProvider`.
 */
function resolvePinnedUt(fixture: Fixture): number | undefined {
  const raw = fixture["t.universalTime"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Reshapes a legacy `v.topology` payload, plus any `r.resourceFor[fid]` and
 * `v.partState[fid]` keys, onto the `vessel.parts` wire, which `useTopology`
 * and `usePartsLive` read with no legacy fallback.
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
 * Reshapes legacy `v.sasValue`/`v.ag{n}Value`/... keys onto the
 * `vessel.control` wire. Only the keys a fixture carries: an absent key stays
 * absent, which the `unknown-state` fixture asserts.
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

  // Nothing this widget reads means no payload, so no provider is mounted.
  return Object.values(control).some((v) => v !== undefined)
    ? control
    : undefined;
}

/** `v.currentStage` -> `vessel.structure.currentStage`: ActionGroup's "Stage" group. */
function resolveVesselStructureWire(fixture: Fixture): unknown {
  const raw = fixture["v.currentStage"];
  return typeof raw === "number" ? { currentStage: raw } : undefined;
}

/** `t.isPaused` -> `time.warp.paused`. Absent key stays absent. */
function resolveTimeWarpWire(fixture: Fixture): unknown {
  const raw = fixture["t.isPaused"];
  return typeof raw === "boolean" ? { paused: raw } : undefined;
}

/** `comm.connected` -> `comms.link.connected`. Absent key stays absent. */
function resolveCommsLinkWire(fixture: Fixture): unknown {
  const raw = fixture["comm.connected"];
  return typeof raw === "boolean" ? { connected: raw } : undefined;
}

/**
 * Per-mode size descriptor. Mirrors `SizeMode` in
 * `packages/components/scripts/widgets.ts` so one mode array drives both the
 * playwright PNG renders and the vitest DOM snapshots.
 */
export interface WidgetSnapshotMode {
  name: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

interface Fixture {
  _meta?: unknown;
  _stream?: StreamFixtureBlock;
  [key: string]: unknown;
}

/**
 * A fixture's own declaration of what it puts on the wire, and the only
 * authority for a fixture that carries one. Structurally identical to the
 * probe's `StreamFixtureBlock` (`scripts/probe/probe-entry.tsx`): one fixture
 * format, read the same way by both harnesses.
 */
interface StreamFixtureBlock {
  /** UT to pin the view clock at. */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds. */
  delaySeconds?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: Array<{ channel: string; value: unknown; meta?: Partial<Meta> }>;
  /**
   * Stage the scene as held: drop the transport once every emit has
   * landed, so the widget is captured holding figures that stopped arriving.
   */
  stopsArriving?: boolean;
  /**
   * The install profiles (`test/installProfile.ts`) this scene is interesting
   * under, by id. A caller passes one as {@link SnapshotOpts.profile}.
   */
  profiles?: string[];
}

/** Extracts and narrows the optional `_stream` block off a fixture. */
function resolveStreamBlock(fixture: Fixture): StreamFixtureBlock | undefined {
  const raw = fixture._stream;
  if (!raw || typeof raw !== "object") return undefined;
  return Array.isArray(raw.emits) ? raw : undefined;
}

interface SnapshotOpts<Config> {
  /** Widget component to mount. */
  Widget: React.ComponentType<ComponentProps<Config>>;
  /** Fixture object: every non-`_`-prefixed key is emitted to the data source. */
  fixture: Fixture;
  /** Grid mode (drives `w`/`h` props and optional per-mode config overlay). */
  mode: WidgetSnapshotMode;
  /** Override the instanceId used by `DashboardItemContext` (rarely needed). */
  instanceId?: string;
  /** Override the default config baseline (config overlay merges on top). */
  defaultConfig?: Config;
  /** Forwarded to `setupMockDataSource`. Default `false`. */
  connectSource?: boolean;
  /**
   * Render under a declared install (`test/installProfile.ts`), by id: the
   * fixture's `_stream` block is rewritten into the wire that install would
   * produce. Applies only to a fixture that has a `_stream` block.
   */
  profile?: string;
}

/**
 * The widget's own contribution stack, mirroring the app's `WidgetContributions`
 * (`GridItemContent.tsx`) and the render probe's `renderWidget`. Without it
 * `useContributions` returns empty and a contribution-driven widget renders an
 * empty frame. The definition is found by matching the mounted component
 * against the registry; an unregistered component mounts untouched.
 */
export function WidgetContributions({
  Widget,
  children,
}: {
  Widget: unknown;
  children: React.ReactNode;
}) {
  const def = getComponents().find((d) => d.component === Widget);
  if (!def) return <>{children}</>;
  return (
    <WidgetMetaContext.Provider
      value={{
        componentId: def.id,
        contributionSlots: def.contributionSlots ?? [],
      }}
    >
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

/** Built once per snapshot render; see {@link buildStreamWrap}. */
interface StreamWrap {
  /** Wraps `children` in the fixture's `TelemetryProvider`, or renders them untouched when none is needed. */
  Wrap: (props: { children: React.ReactNode }) => React.ReactElement;
  /** `true` when a `TelemetryProvider` was mounted; drives {@link flushProviderFrame}. */
  providerMounted: boolean;
  /** Emits the fixture's `v.topology` (reshaped) onto `vessel.parts`. Call inside the same `act()` block as the other emits. */
  emitVesselParts: () => void;
  /** Emits the fixture's legacy control keys (reshaped) onto `vessel.control`/`vessel.structure`. Same `act()` block as the other emits. */
  emitVesselControl: () => void;
  /**
   * Replays `_stream.emits` one topic at a time, each gated on that topic
   * having a live subscription. Awaited after the synchronous emit block,
   * because the gating needs frames to pass.
   */
  replayStreamBlock: () => Promise<void>;
  /** Drops the transport when the fixture declared `_stream.stopsArriving`. */
  dropTransport: () => void;
  /** Mints one view-clock frame, the harness's only frame source. */
  emitFrame: () => void;
}

/**
 * `StubTransport.emit` drops a sample for a topic nothing has subscribed to,
 * and a widget subscribes inside passive effects, so poll until the
 * subscription lands. A topic the widget never reads times out and is dropped.
 */
async function waitForSubscription(
  transport: { isSubscribed(topic: string): boolean },
  topic: string,
  emitFrame: () => void,
  maxFrames = 30,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (transport.isSubscribed(topic)) return;
    // The clock's own loop is suspended, so a frame-driven subscription needs a frame minted per poll.
    emitFrame();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    framesWaited++;
  }
  exhaustedTopics.push(topic);
}

/**
 * Stall diagnostics for a mount that never finishes, read by a timer from
 * outside the awaiting code, since a vitest timeout names only the `it()`
 * line. `exhaustedTopics` records topics `waitForSubscription` gave up on.
 */
let currentPhase = "idle";
let exhaustedTopics: string[] = [];
let framesWaited = 0;

function beginPhase(name: string): void {
  currentPhase = name;
}

function armStallWatchdog(label: string): () => void {
  currentPhase = "start";
  exhaustedTopics = [];
  framesWaited = 0;
  const timers = [5_000, 15_000, 25_000].map((afterMs) =>
    setTimeout(() => {
      process.stderr.write(
        `[widget-harness] ${label} still in phase "${currentPhase}" after ${afterMs}ms, ` +
          `framesWaited=${framesWaited}, ` +
          `neverSubscribed=[${exhaustedTopics.join(" ")}]\n`,
      );
    }, afterMs),
  );
  return () => {
    for (const t of timers) clearTimeout(t);
  };
}

/**
 * Builds the `TelemetryProvider` a snapshot needs. A fixture's own `_stream`
 * block wins outright and replaces the legacy reshapes, rather than sitting
 * beside them, so no reshape can overwrite the fixture's own payload. Returns
 * a pass-through `Wrap` when nothing needs a provider.
 */
function buildStreamWrap(fixture: Fixture, profileId?: string): StreamWrap {
  const declared = resolveStreamBlock(fixture);
  // An install profile rewrites the fixture's own wire, so downstream stays one code path.
  const streamBlock =
    declared !== undefined && profileId !== undefined
      ? (applyInstallProfile(
          getInstallProfile(profileId),
          declared,
        ) as StreamFixtureBlock)
      : declared;
  if (streamBlock !== undefined) {
    const stream = setupStreamFixture({
      pinnedUt: streamBlock.pinnedUt ?? resolvePinnedUt(fixture),
      delaySeconds: streamBlock.delaySeconds,
      suspendFrames: true,
    });
    return {
      Wrap: stream.Provider,
      providerMounted: true,
      emitVesselParts: () => {},
      emitVesselControl: () => {},
      replayStreamBlock: async () => {
        const total = streamBlock.emits.length;
        let done = 0;
        for (const e of streamBlock.emits) {
          beginPhase(`replay-stream emit ${++done}/${total} ${e.channel}`);
          await waitForSubscription(stream.transport, e.channel, () =>
            stream.emitFrame(),
          );
          stream.emit(e.channel, e.value, e.meta);
          stream.emitFrame();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        }
        // A separate phase so a stall in the caller's `act()` settle is told apart from the loop.
        beginPhase("replay-stream act-settle");
      },
      dropTransport: () => {
        if (streamBlock.stopsArriving === true) {
          stream.store.setTransportConnected(false);
        }
      },
      emitFrame: () => stream.emitFrame(),
    };
  }
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
      replayStreamBlock: async () => {},
      dropTransport: () => {},
      emitFrame: () => {},
    };
  }
  const stream = setupStreamFixture({
    pinnedUt,
    suspendFrames: true,
  });
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
    replayStreamBlock: async () => {},
    // The legacy-reshape path reads no `_stream` block, so there is nothing to declare the drop on.
    dropTransport: () => {},
    emitFrame: () => stream.emitFrame(),
  };
}

/**
 * `useViewUt()` and `useTopology`'s stream read only land on a frame, so a
 * plain `render()` + `act()` can commit before the value reaches state. Two
 * hand-minted frames (the clock's loop is suspended), the second for a
 * subscriber that attached on the first frame's commit, each followed by a
 * real animation frame because the provider coalesces onto one.
 */
async function flushProviderFrame(
  providerMounted: boolean,
  emitFrame: () => void,
): Promise<void> {
  if (!providerMounted) return;
  await act(async () => {
    for (let i = 0; i < 2; i++) {
      emitFrame();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
  });
}

/**
 * Caller's override, else the registered `defaultConfig`, else nothing: a
 * widget such as ActionGroup renders nothing useful without its default.
 * Read from the registry each time because `setupMockDataSource` leaves the
 * component registry standing.
 */
function baselineConfig<Config>(opts: SnapshotOpts<Config>): Config {
  if (opts.defaultConfig !== undefined) return opts.defaultConfig;
  const registered = getComponents().find((def) =>
    Object.is(def.component, opts.Widget),
  )?.defaultConfig;
  return (registered as Config | undefined) ?? ({} as Config);
}

/** Grid-unit to pixel conversion, the same arithmetic `scripts/widgetRenderHarness.ts` sizes the playwright iframe with. */
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

function modePixels(mode: WidgetSnapshotMode): { w: number; h: number } {
  return {
    w: mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN,
    h: mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN,
  };
}

/**
 * Install a `ResizeObserver` that reports the mode's own pixel size, for the
 * length of one render. The shared jsdom shim never calls its callback, so a
 * widget gating content on a measured box (`Graph` above all) would never
 * render it. Restored afterwards; already-constructed observers keep working.
 */
export function installSizedResizeObserver(size: {
  w: number;
  h: number;
}): () => void {
  // Asynchronous, like the real one: a synchronous callback would run inside the observing effect and set state during render.
  return installFixedSizeResizeObserver({
    width: size.w,
    height: size.h,
    deliver: "macrotask",
  });
}

/**
 * Let the sized-observer callbacks land and the re-render commit. Two turns:
 * the second covers an observer a re-render only then attached.
 */
export async function flushResizeObservers(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Mount a widget, emit every fixture key onto its data source, and return the
 * stripped innerHTML for snapshotting. Mirrors the playwright probe
 * (`scripts/probe/probe-entry.tsx`) at the DOM level. Canvas content and
 * CSS-paint visuals live in the playwright PNGs.
 */
export async function snapshotWidgetMode<
  Config extends object = Record<string, unknown>,
>(opts: SnapshotOpts<Config>): Promise<string> {
  // As the probe does, so body-aware widgets resolve `Kerbin`, `Mun`, etc.
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
  const restoreResizeObserver = installSizedResizeObserver(
    modePixels(opts.mode),
  );
  const disarm = armStallWatchdog(`snapshot ${opts.mode.name}`);

  try {
    const config: Config = {
      ...baselineConfig(opts),
      ...((opts.mode.config ?? {}) as Config),
    };
    const instanceId = opts.instanceId ?? "snap";
    const {
      Wrap,
      providerMounted,
      emitVesselParts,
      emitVesselControl,
      replayStreamBlock,
      dropTransport,
      emitFrame,
    } = buildStreamWrap(opts.fixture, opts.profile);
    beginPhase("render");
    const { container } = render(
      <Wrap>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <WidgetContributions Widget={opts.Widget}>
            <opts.Widget
              config={config}
              id={instanceId}
              w={opts.mode.w}
              h={opts.mode.h}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </Wrap>,
    );

    // Mount, then emit, matching the probe; act() so the snapshot does not race the commit.
    beginPhase("seed-emits");
    act(() => {
      if (!fixtureEmitsMuted()) {
        for (const key of fixtureKeys) {
          source?.emit(key, opts.fixture[key]);
        }
      }
      emitVesselParts();
      emitVesselControl();
    });
    // Each entry waits for its topic's subscription, which only lands once frames have run.
    beginPhase("replay-stream");
    await act(async () => {
      await replayStreamBlock();
    });
    beginPhase("provider-frame");
    await flushProviderFrame(providerMounted, emitFrame);

    beginPhase("flush-resize-observers");
    await flushResizeObservers();

    // Last, so a held scene differs from its live twin by the drop alone.
    beginPhase("stops-arriving");
    dropTransport();
    await flushProviderFrame(providerMounted, emitFrame);

    beginPhase("done");
    return stripVolatile(container.innerHTML);
  } finally {
    disarm();
    restoreResizeObserver();
    teardownMockDataSource(fixture);
    source = null;
  }
}

/** Live render handle from {@link renderWidgetMode}. */
export interface RenderedWidget {
  /** The mounted, still-live container: valid until `teardown()`. */
  container: HTMLElement;
  /** Unmount and disconnect. Must be called by the test after its assertions. */
  teardown: () => void;
}

/**
 * Mount a widget exactly like {@link snapshotWidgetMode} but leave it mounted,
 * returning the live `container` and a `teardown()` the caller must run.
 */
export async function renderWidgetMode<
  Config extends object = Record<string, unknown>,
>(opts: SnapshotOpts<Config>): Promise<RenderedWidget> {
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
  const restoreResizeObserver = installSizedResizeObserver(
    modePixels(opts.mode),
  );
  const disarm = armStallWatchdog(`render ${opts.mode.name}`);

  try {
    const config: Config = {
      ...baselineConfig(opts),
      ...((opts.mode.config ?? {}) as Config),
    };
    const instanceId = opts.instanceId ?? "snap";
    const {
      Wrap,
      providerMounted,
      emitVesselParts,
      emitVesselControl,
      replayStreamBlock,
      dropTransport,
      emitFrame,
    } = buildStreamWrap(opts.fixture, opts.profile);
    beginPhase("render");
    const { container } = render(
      <Wrap>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <WidgetContributions Widget={opts.Widget}>
            <opts.Widget
              config={config}
              id={instanceId}
              w={opts.mode.w}
              h={opts.mode.h}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </Wrap>,
    );

    beginPhase("seed-emits");
    act(() => {
      if (!fixtureEmitsMuted()) {
        for (const key of fixtureKeys) {
          source.emit(key, opts.fixture[key]);
        }
      }
      emitVesselParts();
      emitVesselControl();
    });
    beginPhase("replay-stream");
    await act(async () => {
      await replayStreamBlock();
    });
    beginPhase("provider-frame");
    await flushProviderFrame(providerMounted, emitFrame);

    beginPhase("flush-resize-observers");
    await flushResizeObservers();
    beginPhase("stops-arriving");
    dropTransport();
    await flushProviderFrame(providerMounted, emitFrame);
    beginPhase("done");
    return { container, teardown: () => teardownMockDataSource(fixture) };
  } catch (err) {
    // A caller that never receives the teardown cannot run it.
    teardownMockDataSource(fixture);
    throw err;
  } finally {
    disarm();
    restoreResizeObserver();
  }
}

/**
 * Strip styled-components hashes, testing-library auto-ids and any `sc-*`
 * class or id, so a snapshot does not churn per build.
 */
export function stripVolatile(html: string): string {
  return normaliseReactIds(
    html
      .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
      .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
      .replace(/\sdata-testid="[^"]+"/g, "")
      .replace(/\sdata-sc[a-z-]*="[^"]*"/g, ""),
  );
}

/**
 * Rewrite React `useId` values (`:r3:`) to their order of first appearance
 * (`:rid0:`): the counter shifts with every hook that ran first, including on
 * a different machine. A mapping rather than a blanket replace, so an
 * `aria-controls` naming the wrong element still fails the compare.
 */
export function normaliseReactIds(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/:r[0-9a-z]+:/g, (id) => {
    const existing = seen.get(id);
    if (existing !== undefined) return existing;
    const token = `:rid${seen.size}:`;
    seen.set(id, token);
    return token;
  });
}
