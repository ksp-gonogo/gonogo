/**
 * Mounts one registered widget on one fixture scene, sized to a grid tile.
 *
 * The render harness's probe page (`probe-page.tsx`) and the Storybook widget
 * stories both mount through {@link renderProbe}, so a story is the same widget
 * on the same fixture the harness photographs.
 *
 * A fixture's plain keys feed a MockDataSource (wrapped in BufferedDataSource so
 * late re-subscribes don't lose the seeded value) registered as the "data"
 * source. A fixture's `_stream` block (see `StreamFixtureBlock` below) builds a
 * real `setupStreamFixture` instead, the same test adapter the widgets' own
 * headless tests use, mounts the widget inside its `Provider`, and replays the
 * block's `emits` through `StubTransport.emit` once each topic is subscribed.
 */
/*
 * MUST be the first import: installs the injected gonogo host before the
 * planted Uplink below registers through it, which would otherwise throw "the
 * gonogo host has not been installed" at module load.
 */
import "./probe-install-host";
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  getDataSource,
  registerDataSource,
  registerStockBodies,
  unregisterDataSource,
  useWidgetBadges,
  WidgetMetaContext,
  WidgetStreamStatusBridge,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { type Meta, splitRawFieldSubtopic } from "@ksp-gonogo/sitrep-sdk";
import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  type BadgeEntry,
  DomainAvailabilityProvider,
  defaultDarkTheme,
  PanelBadgesProvider,
  PanelStatusStoreProvider,
} from "@ksp-gonogo/ui-kit";
import { createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect import: every widget self-registers on module load.
import "../../src";
import { AugmentAvailabilityFeeder } from "../../../app/src/telemetry/AugmentAvailabilityFeeder";
import {
  AlarmsLauncherProvider,
  type PendingAlarmSummary,
} from "../../src/shared/AlarmsLauncher";
import {
  applyInstallProfile,
  getInstallProfile,
} from "../../src/test/installProfile";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";
import { mountGridCell } from "./gridCell";
import type { ProbePayload, ProbeSeriesSample } from "./payload";
/*
 * The planted Uplink's contributions into built-in widgets. Each requires the
 * planted Domain, so only a fixture emitting `planted.available` renders any.
 */
import "./plantedUplink";

/*
 * Filled once at module load, as the app's main.tsx does: a body-aware widget
 * reads the stock bodies through getBody(v.body) and draws "unknown body" without them.
 */
registerStockBodies();

/** One `StubTransport.emit(topic, payload)` call, replayed post-mount. */
export interface StreamEmit {
  channel: string;
  value: unknown;
  /**
   * Optional per-sample meta overrides, forwarded to `StubTransport.emit`'s
   * third arg (same `Partial<Meta>` the widgets' own headless tests pass),
   * e.g. `quality: Quality.Loaded` (1) for a sample from a craft under physics.
   */
  meta?: Partial<Meta>;
}

/**
 * Fixture block for stream-driven mod-client widgets: see this file's top
 * doc comment. Keyed `_stream` so it is filtered out of the plain-key
 * `MockDataSource` path the same way every other `_`-prefixed fixture key is.
 */
export interface StreamFixtureBlock {
  /** Forwarded to `setupStreamFixture`: topics this fixture carries. */
  carriedChannels: string[];
  /** Forwarded to `setupStreamFixture`: UT to pin the view clock at. */
  pinnedUt?: number;
  /** Forwarded to `setupStreamFixture`: fixed network/display delay. */
  delaySeconds?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: StreamEmit[];
  /**
   * Stage the scene as NOT CURRENT: once every emit has landed and the tree has
   * settled, drop the transport and mint a frame, so the shot is of a widget
   * whose figures have stopped arriving.
   *
   * Without it the harness can only picture a live scene, and the visible
   * product of the reckoning work is precisely what a widget draws when a
   * figure is NOT current: the mark on the figure, the held value where a null
   * token used to be, the caption naming the state. A field reading and a
   * minted `Value` of the same magnitude draw identical pixels, so a stale
   * scene rendered live is byte-identical to its live twin and shows nothing
   * (measured on CareerEconomy before this existed: the same md5 for both).
   *
   * The DROP is the lever rather than a clock advance because it is the one the
   * widgets' own stale tests use (`store.setTransportConnected(false)`), so a
   * render and the test asserting on it are staging the same thing. The other
   * two routes to a not-current reading are already reachable from a fixture
   * and need nothing here: a server-stamped `meta.staleness` goes on the emit
   * itself, and a confirmed absence is a `null` payload.
   */
  stopsArriving?: boolean;
  /**
   * The install profiles this scene is interesting under
   * (`src/test/installProfile.ts`), by id. The SCENE names them, so the matrix
   * stays a scene's own decision rather than every widget times every install.
   * The render harness reads this list and asks for one render per id; a
   * fixture that names none renders under the wire it declares, unchanged.
   */
  profiles?: string[];
}

/**
 * Extracts and narrows the optional `_stream` block off a fixture, rewritten
 * into the wire the requested install would put out.
 *
 * An install profile REPLACES the fixture's own wire rather than sitting beside
 * it, so everything downstream (the carried allowlist, the emit order, the
 * subscription gating) stays one code path reading one block. Same treatment
 * the DOM-snapshot harness gives it, off the same fixture JSON and the same
 * pure transform.
 */
function resolveStreamBlock(
  fixture: Record<string, unknown>,
  profileId: string | undefined,
): StreamFixtureBlock | undefined {
  const raw = (fixture as { _stream?: StreamFixtureBlock })._stream;
  if (!raw) return undefined;
  if (profileId === undefined) return raw;
  return applyInstallProfile(
    getInstallProfile(profileId),
    raw,
  ) as StreamFixtureBlock;
}

/**
 * A `_series` block as stream samples: one emit per Topic per instant, the
 * fields of one Topic that share an instant merged into one payload, in time
 * order. A sample's `t` is milliseconds relative to the pinned view time, so
 * `t = 0` lands at the instant the widget reads.
 */
function seriesEmits(
  series: Record<string, readonly ProbeSeriesSample[]>,
  pinnedUt: number,
): StreamEmit[] {
  const byInstant = new Map<string, StreamEmit & { validAt: number }>();
  for (const [key, samples] of Object.entries(series)) {
    const split = splitRawFieldSubtopic(key);
    const channel = split?.rawTopic ?? key;
    for (const sample of samples) {
      const validAt = pinnedUt + sample.t / 1000;
      const id = `${channel}@${validAt}`;
      const known = byInstant.get(id);
      const entry = known ?? {
        channel,
        value: split ? {} : undefined,
        meta: { validAt },
        validAt,
      };
      if (!known) byInstant.set(id, entry);
      if (!split) {
        entry.value = sample.v;
        continue;
      }
      setFieldPath(
        entry.value as Record<string, unknown>,
        split.fieldPath,
        sample.v,
      );
    }
  }
  return [...byInstant.values()].sort((a, b) => a.validAt - b.validAt);
}

/** The Topics a `_series` block plots from, which the scene carries so their fields keep their units. */
function seriesChannels(
  series: Record<string, readonly ProbeSeriesSample[]>,
): string[] {
  return [
    ...new Set(
      Object.keys(series).map(
        (key) => splitRawFieldSubtopic(key)?.rawTopic ?? key,
      ),
    ),
  ];
}

function setFieldPath(
  record: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let node = record;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (next === null || typeof next !== "object") node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/**
 * A fixture's `"t.universalTime"` key is the view instant a widget reads
 * through `useViewUt()`, which needs a mounted `TelemetryProvider` to resolve
 * to anything at all. Pin one from the fixture's own value so no per-widget
 * probe config is needed. Fixtures with no such key are unaffected
 * (`undefined`, no `TelemetryProvider` mounted).
 */
function resolvePinnedUt(fixture: Record<string, unknown>): number | undefined {
  const raw = fixture["t.universalTime"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** See {@link resolvePinnedUt}. `undefined` renders `children` untouched. */
function wrapWithPinnedViewUt(
  pinnedUt: number | undefined,
  children: React.ReactNode,
): React.ReactNode {
  if (pinnedUt === undefined) return createElement(Fragment, null, children);
  const { Provider } = setupStreamFixture({ carriedChannels: [], pinnedUt });
  return createElement(Provider, null, children);
}

/** The header badges a scene's `_badges` block names. */
function sceneBadges(payload: ProbePayload): readonly BadgeEntry[] {
  return (payload.fixture._badges as readonly BadgeEntry[] | undefined) ?? [];
}

/** The app's `WidgetBadges`: the widget's contributed header badges, after the scene's own. */
function ContributedBadges({
  scene,
  children,
}: {
  scene: readonly BadgeEntry[];
  children: React.ReactNode;
}): React.ReactElement {
  const contributed = useWidgetBadges();
  return createElement(
    PanelBadgesProvider,
    { badges: [...scene, ...contributed] },
    children,
  );
}

function withContributedBadges(
  payload: ProbePayload,
  tree: React.ReactElement,
): React.ReactElement {
  if (!payload.asDashboard) return tree;
  return (
    <ContributedBadges scene={sceneBadges(payload)}>{tree}</ContributedBadges>
  );
}

/** One widget mounted by {@link mountProbe}, torn down on its own. */
export interface ProbeMount {
  /** Resolves once the fixture has landed and the layout has settled; rejects with the mount's failure. */
  ready: Promise<void>;
  /** Emits one sample onto this scene's own stream; a scene with no `_stream` block has none, and throws. */
  emit: (channel: string, value: unknown, meta?: Partial<Meta>) => void;
  /** Unmounts this widget alone and drops its data source; safe before `ready` settles. */
  unmount: () => void;
}

/** What one mount has set up so far, for its own unmount to take down. */
interface MountState {
  root: Root | null;
  buffered: BufferedDataSource | null;
  stream: StreamFixture | undefined;
  disposed: boolean;
  beside: boolean;
}

function teardownMount(state: MountState): void {
  state.disposed = true;
  state.root?.unmount();
  state.root = null;
  state.stream = undefined;
  const buffered = state.buffered;
  state.buffered = null;
  if (!buffered) return;
  buffered.disconnect();
  // The "data" source is one per page, and only the mount holding it drops it.
  if (getDataSource(buffered.id) === buffered) {
    unregisterDataSource(buffered.id);
  }
}

/** The mount {@link renderProbe} last made, which the next call replaces. */
let current: ProbeMount | null = null;

/** Unmounts the widget {@link renderProbe} last mounted and drops its data source. */
export function unmountProbe(): void {
  current?.unmount();
  current = null;
}

/**
 * Mounts `payload`'s widget into `root` on its fixture, replacing whatever the
 * previous call mounted, and resolves once the fixture has landed and the
 * layout has settled.
 */
export async function renderProbe(
  root: HTMLElement,
  payload: ProbePayload,
  opts: ProbeMountOptions = {},
): Promise<void> {
  unmountProbe();
  current = startMount(root, payload, opts, false);
  await current.ready;
}

export interface ProbeMountOptions {
  /** Providers an in-page caller puts around the widget, inside the probe's own. */
  wrap?: (tree: React.ReactNode) => React.ReactNode;
}

/**
 * Mounts `payload`'s widget into `root` on its fixture, leaving every other
 * mount on the page standing.
 *
 * The legacy "data" source is page-wide and held by the first live mount that
 * claims it. Processors evaluate against each mount's own store; the sdk's
 * non-hook accessors (`getViewUt`, `getVesselOrbit`) follow the latest mount.
 */
export function mountProbe(
  root: HTMLElement,
  payload: ProbePayload,
  opts: ProbeMountOptions = {},
): ProbeMount {
  return startMount(root, payload, opts, true);
}

/** `beside` leaves a "data" source another mount registered in place rather than replacing it. */
function startMount(
  root: HTMLElement,
  payload: ProbePayload,
  opts: ProbeMountOptions,
  beside: boolean,
): ProbeMount {
  const state: MountState = {
    root: null,
    buffered: null,
    stream: undefined,
    disposed: false,
    beside,
  };
  const ready = mountInto(root, payload, opts, state).catch((err: unknown) => {
    if (state.disposed) return;
    throw err;
  });
  return {
    ready,
    emit: (channel, value, meta) => {
      if (!state.stream) {
        throw new Error(
          `Probe: "${payload.widgetId}" has no stream to emit on: its fixture carries no _stream block, or it is unmounted`,
        );
      }
      state.stream.emit(channel, value, meta);
    },
    unmount: () => teardownMount(state),
  };
}

async function mountInto(
  root: HTMLElement,
  payload: ProbePayload,
  opts: ProbeMountOptions,
  state: MountState,
): Promise<void> {
  // Stream-driven mod-client widgets carry their fixture
  // data in `_stream` rather than plain data keys; see this file's top doc
  // comment and `StreamFixtureBlock`. Resolved once up-front so both the
  // provider-wrap choice below and the post-mount emit loop share it.
  const streamBlock = resolveStreamBlock(payload.fixture, payload.profile);
  // A `_series` block plots off the stream, so it needs one even where the fixture declares none.
  const seriesPinnedUt =
    streamBlock?.pinnedUt ?? resolvePinnedUt(payload.fixture) ?? 0;
  const streamFixture: StreamFixture | undefined = streamBlock
    ? setupStreamFixture({
        carriedChannels: streamBlock.carriedChannels,
        pinnedUt: streamBlock.pinnedUt,
        delaySeconds: streamBlock.delaySeconds,
      })
    : payload.series
      ? setupStreamFixture({
          carriedChannels: seriesChannels(payload.series),
          pinnedUt: seriesPinnedUt,
        })
      : undefined;
  state.stream = streamFixture;

  const fixtureKeys = Object.keys(payload.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  const source = new MockDataSource({
    id: "data",
    keys: fixtureKeys.map((k) => ({ key: k })),
  });
  const buffered = new BufferedDataSource({ source, store: new MemoryStore() });
  state.buffered = buffered;
  if (!state.beside || !getDataSource(buffered.id)) {
    registerDataSource(buffered);
  }
  await buffered.connect();

  // Force-load BOTH locked-font weights before mounting so the very first
  // layout uses JetBrains Mono metrics for regular AND bold text. Awaiting
  // `document.fonts.ready` alone is not enough: it resolves once the fonts
  // currently in the loading set are done, but a weight the layout hasn't
  // requested yet may not be in that set, so in Firefox the 700 face could
  // still be its (taller) fallback at screenshot time, inflating bold text
  // (status pills, tags, labels) enough to overflow tight widgets like
  // thermal and clip a row. Explicitly loading each weight then awaiting
  // ready guarantees both faces are decoded and applied. This also removes
  // the fallback-vs-real nondeterminism and lets ScrollArea's ResizeObserver
  // see final sizes on mount (so its scroll-glow fires when content overflows).
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load('400 1em "JetBrains Mono"'),
      document.fonts.load('700 1em "JetBrains Mono"'),
    ]);
    await document.fonts.ready;
  }

  const def = getComponent(payload.widgetId);
  if (!def) {
    throw new Error(`Probe: widget "${payload.widgetId}" not registered`);
  }
  /* The dashboard never gives a widget less than its minSize, so a render
     there pictures a screen no operator can reach, and anything it finds is a
     finding about nothing. */
  const min = def.minSize;
  if (min && (payload.w < min.w || payload.h < min.h)) {
    throw new Error(
      `Probe: "${payload.widgetId}" at ${payload.w}x${payload.h} is below its minSize ${min.w}x${min.h}, a size the dashboard never gives it`,
    );
  }
  const WidgetComponent = def.component as React.ComponentType<{
    config: Record<string, unknown>;
    id: string;
    w?: number;
    h?: number;
  }>;

  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.overflow = "hidden";
  root.style.background = "var(--color-surface-app)";

  const instanceId = payload.instanceId ?? "probe";

  // The widget tree proper: shared by both provider-wrap branches below.
  const buildWidgetTree = (): React.ReactNode => {
    // Wrap with a no-op AlarmsLauncherProvider so widgets that opt into
    // alarm chrome (`useAlarmsLauncher` / `useAlarmCreator` /
    // `useAlarmManager`) get a real launcher reference and render their
    // bell affordance. Without the provider those hooks return null and
    // the bell vanishes from harness PNGs even though it's the operator
    // workflow in live use. The launcher / creator / manager fns are
    // probe-only stubs: clicking them does nothing because there's no
    // alarm pipeline in the probe page; but the rendered chrome is the
    // thing we want to verify.
    //
    // `WidgetMetaContext` + `ContributionsProvider` mirror the real app's
    // `WidgetContributions` wrapper (GridItemContent.tsx): without them any
    // widget calling `useContributions`/`useWidgetBadges` in its own body
    // sees no store at all (a silent empty result, not an error), so a
    // widget whose RENDERED content depends on a contribution (ShipMap's
    // per-part meters/meta, spec §13.4) would render as if nothing had ever
    // contributed, in every probe/render-widget/visual-gate PNG. Safe for
    // every other widget: nothing here reads `useWidgetBadges` from its own
    // body (only the dashboard's Panel chrome does, which the probe never
    // mounts), so this changes zero existing pixels.
    const meta = {
      componentId: def.id,
      contributionSlots: def.contributionSlots ?? [],
    };
    const tree = createElement(
      WidgetMetaContext.Provider,
      { value: meta },
      createElement(
        // The per-item status store plus the blackout bridge, the same pair the
        // dashboard mounts (GridItemContent). Without them a widget whose
        // fixture stamps `Staleness.Recorded` renders with no pill, so the
        // harness would picture the state and omit the one mark that names it.
        // No effect on any other fixture: the bridge contributes nothing while
        // every declared channel is live, which is every other fixture in the
        // tree.
        PanelStatusStoreProvider,
        null,
        createElement(WidgetStreamStatusBridge, { def }),
        createElement(
          ContributionsProvider,
          null,
          withContributedBadges(
            payload,
            <AlarmsLauncherProvider
              launcher={() => {}}
              creator={() => {}}
              manager={{ find: () => null, remove: () => {} }}
              // A scene's `_alarms` stands in for the pipeline's pending list.
              // Absent means the tree has no pipeline to ask.
              pending={
                payload.fixture._alarms as
                  | readonly PendingAlarmSummary[]
                  | undefined
              }
            >
              {createElement(
                DashboardItemContext.Provider,
                { value: { instanceId } },
                createElement(WidgetComponent, {
                  config: payload.config ?? def.defaultConfig ?? {},
                  id: instanceId,
                  w: payload.w,
                  h: payload.h,
                }),
              )}
            </AlarmsLauncherProvider>,
          ),
        ),
      ),
    );
    /**
     * A scene's `_badges` block, mounted the way the dashboard mounts the
     * widget's automatic `<id>.badges` contribution slot: through
     * `PanelBadgesProvider`, which is what `Panel` reads to render its header
     * badge pills.
     *
     * Without it a contributed header badge reaches no PNG at all. `Panel`
     * asks the context for its pills and the probe never supplied one, so
     * every render pictured a header with the widget's own aside and nothing
     * an Uplink had added beside it, which is exactly the competition for
     * header width that the aside's measured-fit collapse turns on. Absent
     * from the scene the provider is skipped entirely rather than mounted
     * empty, so no existing render moves.
     */
    const badges = sceneBadges(payload);
    if (payload.asDashboard || badges.length === 0) return tree;
    return createElement(PanelBadgesProvider, { badges }, tree);
  };

  const wrapped = (): React.ReactNode =>
    opts.wrap ? opts.wrap(buildWidgetTree()) : buildWidgetTree();

  if (!payload.gridCell) {
    // A cell left by an earlier render on this page would still be laying the widget out.
    root.replaceChildren();
    root.style.display = "";
    root.style.flexDirection = "";
  }
  if (state.disposed) return;
  state.root = createRoot(payload.gridCell ? mountGridCell(root) : root);
  state.root.render(
    // ui-kit-composed widgets read design tokens off the styled-components
    // theme (e.g. `theme.space.md` in Stack): without a ThemeProvider the
    // theme is `{}` and those reads throw "reading 'md'". Match the live app's
    // ThemeProvider so the probe renders migrated widgets the same way.
    createElement(
      ThemeProvider,
      { theme: defaultDarkTheme },
      streamFixture
        ? createElement(
            streamFixture.Provider,
            null,
            createElement(
              DomainAvailabilityProvider,
              null,
              createElement(AugmentAvailabilityFeeder, null),
              wrapped(),
            ),
          )
        : wrapWithPinnedViewUt(resolvePinnedUt(payload.fixture), wrapped()),
    ),
  );

  // Let React commit + useEffect run (so useDataValue / useStream actually subscribe) before we start emitting values.
  await rafTick();

  for (const key of fixtureKeys) {
    source.emit(key, payload.fixture[key]);
  }
  if (streamFixture && payload.series) {
    const history = seriesEmits(payload.series, seriesPinnedUt);
    for (const channel of new Set(history.map((e) => e.channel))) {
      await waitForSubscription(streamFixture.transport, channel);
    }
    for (const e of history) streamFixture.emit(e.channel, e.value, e.meta);
    await rafTick();
  }
  if (streamFixture && streamBlock) {
    // `StubTransport.emit` is subscription-gated (silently DROPS a sample for
    // a topic nothing has subscribed to yet; see that method's own doc
    // comment). The widget subscribes to its topics inside React *passive*
    // effects (`useStream`/`useTelemetry` → `client.subscribe`), and a single
    // `requestAnimationFrame` does NOT reliably flush those: rAF callbacks and
    // React 18's MessageChannel-scheduled passive effects have no fixed
    // ordering, so whether the subscribe has landed when we emit is a
    // per-run/per-engine coin-flip. When it loses, the sample is dropped and
    // the widget stays in its empty/initial state, a different capture than a
    // run where it won. That is exactly the launch-director visual-gate
    // flake: two renders of the SAME fixture disagree run-to-run,
    // so no baseline regeneration can ever converge.
    //
    // Fix: gate each emit on its topic actually being subscribed. Polling
    // `isSubscribed(topic)` with `rafTick`s deterministically waits out the
    // passive-effect subscription wave regardless of scheduler ordering, and
    // also covers the causal chain (a widget that subscribes to a per-subject
    // topic only once an earlier emit names the subject)
    // because each prior emit's re-render, and the subscription it triggers:
    // has landed before we wait for the next channel. A topic the widget never
    // reads simply times out and is emitted-then-dropped, exactly as before.
    for (const e of streamBlock.emits) {
      await waitForSubscription(streamFixture.transport, e.channel);
      streamFixture.emit(e.channel, e.value, e.meta);
      await rafTick();
    }
  }

  // Two more frames: the first lets React commit the value-driven re-render, the second lets the ResizeObserver-driven dialFit land and re-render.
  await rafTick();
  await rafTick();
  // CSS transitions on transform / opacity can keep moving for a few
  // frames after the React render commits (the heading-strip ticker has
  // `transition: transform 80ms linear`). Without a settle delay the
  // screenshot catches the strip mid-flight, which reads as a
  // strip-alignment bug. Padding generously past the longest known
  // transition (80ms) keeps the harness deterministic.
  await settle(200);

  // Synthetic clicks fire AFTER the value emit + settle so React state
  // is fully committed before the click handlers run. Each click waits
  // `awaitMs` (default 100ms) so the resulting state change has time
  // to render before the next click / screenshot.
  if (payload.clicks && payload.clicks.length > 0) {
    for (const c of payload.clicks) {
      const el = findIn(root, c.selector);
      if (!el) {
        throw new Error(`Probe: click selector "${c.selector}" not found`);
      }
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await settle(c.awaitMs ?? 100);
    }
  }

  // Hovers come after the clicks, so a mode may open a panel and then put the
  // pointer on something inside it. Nothing moves the pointer away again: the
  // hovered state IS what a hover mode is capturing.
  if (payload.hovers && payload.hovers.length > 0) {
    for (const h of payload.hovers) {
      const el = findIn(root, h.selector);
      if (!el) {
        throw new Error(`Probe: hover selector "${h.selector}" not found`);
      }
      for (const type of ["pointerover", "pointerenter"]) {
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: type === "pointerover" }),
        );
      }
      await settle(h.awaitMs ?? 100);
    }
  }

  // The drop goes LAST, after the clicks, because that is the order an operator
  // meets it: a panel is opened, a control is armed, and then the link goes. Run
  // before them instead and a click-driven mode would be reaching for controls a
  // not-current widget has already disabled, so the two features could not be
  // used in one scene. `beginFrame` mints the frame that publishes the new
  // status rather than waiting on the provider's own rAF loop, so the shot does
  // not depend on which of the two lands first.
  if (streamFixture && streamBlock?.stopsArriving) {
    streamFixture.store.setTransportConnected(false);
    streamFixture.store.beginFrame();
    await rafTick();
    await rafTick();
    await settle(200);
  }
}

/** The first match inside this mount, then anywhere on the page, where a portal it opened draws. */
function findIn(root: HTMLElement, selector: string): Element | null {
  return root.querySelector(selector) ?? document.querySelector(selector);
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Wait until `topic` has an active subscription on the stream transport, or
 * until `maxFrames` frames elapse. `StubTransport.emit` drops samples for an
 * unsubscribed topic, and the widget subscribes inside React passive effects
 * that a single `rafTick` can't be relied on to have flushed, so replaying a
 * `_stream` emit before its subscription lands is the source of the
 * launch-director visual-gate flake. Polling here makes the
 * replay deterministic. A topic the widget never reads never subscribes; the
 * bounded loop then returns and the caller emits-then-drops it (harmless,
 * matches the prior behaviour for ignored channels). The bound is generous,
 * realistic causal chains resolve in one or two frames.
 */
async function waitForSubscription(
  transport: { isSubscribed(topic: string): boolean },
  topic: string,
  maxFrames = 30,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (transport.isSubscribed(topic)) return;
    await rafTick();
  }
}

function settle(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
