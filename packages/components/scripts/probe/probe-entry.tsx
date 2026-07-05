/**
 * Widget probe entry — bundled by esbuild for the playwright render
 * harness. Exposes `window.__renderProbe({...})` so the driver can mount
 * the same probe page many times with different fixture / size payloads
 * without reloading or re-bundling.
 *
 * The probe registers a MockDataSource (wrapped in BufferedDataSource so
 * late re-subscribes don't lose the seeded value) as the "data" source,
 * mounts the requested widget inside DashboardItemContext, sizes the
 * container to the requested pixel box, then synchronously emits every
 * fixture key. A second animation frame lets ResizeObserver and the
 * widget's internal layout settle before the driver screenshots.
 *
 * kOS feed widgets (kos-processors, …) read from a separate `"kos"` source
 * and pull topic status via `useKosScriptStatus` → `getTopicStatus` /
 * `onTopicStatusChange`. The probe registers a `ProbeKosDataSource` (a
 * MockDataSource subclass that adds those two methods, returning a static
 * healthy status) under `id: "kos"` and routes any fixture key prefixed
 * `kos.` to it. It is registered *unbuffered* — buffer-wrapping would hide
 * the topic-status methods so `useKosScriptStatus` would silently fall back
 * to the empty status.
 */
import {
  DashboardItemContext,
  getComponent,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
  unregisterDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// Side-effect import: every widget self-registers on module load.
import "../../src";
import { AlarmsLauncherProvider } from "../../src/shared/AlarmsLauncher";

// Stock-body registry needs to be populated before any widget that calls
// getBody(v.body) tries to read it. The live app does this in main.tsx;
// the probe needs the equivalent or every body-aware widget renders the
// "unknown body" degraded state. Run once at module load — the registry
// is idempotent and shared across all probe calls.
registerStockBodies();

/**
 * MockDataSource that also speaks the centralised kOS compute topic-status
 * surface (`getTopicStatus` / `onTopicStatusChange`) that `useKosScriptStatus`
 * sniffs for. Returns a static healthy status for any topic so the
 * KosScriptFrame chrome renders "last good" recent + not paused + not
 * erroring. The fixture payload itself drives the body (the processors
 * list); the status only governs the frame chrome. Kept probe-local so the
 * shared `@gonogo/core` MockDataSource stays untouched.
 */
class ProbeKosDataSource extends MockDataSource {
  // Sticky last-value cache. The base MockDataSource.emit only pushes to
  // CURRENT subscribers, so a value emitted before a subscriber's passive
  // effect lands is lost forever. The `"data"` source dodges this because
  // it's wrapped in BufferedDataSource, which replays last-value on
  // subscribe — the unbuffered `"kos"` source is the lone outlier. Mirror
  // the real KosDataSource contract ("late subscribers get the most recent
  // value immediately") by caching emits and replaying on subscribe. Makes
  // the render deterministic regardless of subscribe/emit ordering.
  private readonly lastValues = new Map<string, unknown>();

  emit(key: string, value: unknown): void {
    this.lastValues.set(key, value);
    super.emit(key, value);
  }

  subscribe(key: string, cb: (v: unknown) => void): () => void {
    const unsub = super.subscribe(key, cb);
    // Synchronous replay is safe — subscribe runs in a passive effect, not
    // during render — and is more deterministic for screenshots than
    // deferring to a microtask.
    if (this.lastValues.has(key)) cb(this.lastValues.get(key));
    return unsub;
  }

  // Healthy, recent, idle. `running:false` so a payload-less render shows the
  // run prompt rather than a perpetual "Scanning…"; with a payload present
  // the widget renders the list regardless.
  getTopicStatus() {
    return {
      lastGoodAt: Date.now(),
      scriptError: null,
      parseError: null,
      paused: false,
      running: false,
    };
  }

  // No status transitions in the static probe — return a no-op unsubscribe.
  onTopicStatusChange(): () => void {
    return () => {};
  }
}

export interface ProbeSeriesSample {
  t: number;
  v: unknown;
}

export interface ProbePayload {
  widgetId: string;
  fixture: Record<string, unknown>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  config?: Record<string, unknown>;
  instanceId?: string;
  /**
   * Optional per-key time-series to seed the BufferedDataSource's
   * MemoryStore *before* the widget mounts. Widgets that call
   * `useDataSeries` (sparklines, live trace dots) backfill from
   * `queryRange` on mount — seeding the store lets those render with
   * real history instead of always-empty arrays.
   *
   * Sample timestamps are unix-ms relative to `now`. The probe stamps
   * its synthetic flight at `t=0`; sample timestamps should be within
   * the widget's window (Twr=60s, KeplerPeriod=60s, etc.). Use
   * positive numbers — the probe queries `[now - windowMs, now]`.
   */
  series?: Record<string, readonly ProbeSeriesSample[]>;
  /**
   * Optional synthetic clicks dispatched after the standard mount +
   * emit + settle. Unlocks interactive states that the static render
   * can't reach — modal opens, arm-then-confirm sequences, dropdown
   * pickers (LaunchDirector crew picker, etc).
   *
   * Each entry runs sequentially: the matching DOM node is clicked
   * via `dispatchEvent(MouseEvent("click"))`, then the probe waits
   * `awaitMs` (or `100` if omitted) before the next click and before
   * the final screenshot. Missing selectors throw — the driver
   * surfaces the error so brittle fixtures get caught.
   */
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
}

let activeRoot: Root | null = null;
let activeSource: MockDataSource | null = null;
let activeBuffered: BufferedDataSource | null = null;
let activeStore: MemoryStore | null = null;
// Unbuffered `kos` source for kOS-feed widgets. Registered directly so its
// topic-status methods stay visible to `useKosScriptStatus`.
let activeKos: ProbeKosDataSource | null = null;

async function renderProbe(payload: ProbePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeBuffered) {
    activeBuffered.disconnect();
    unregisterDataSource(activeBuffered.id);
    activeBuffered = null;
  }
  if (activeKos) {
    activeKos.disconnect();
    unregisterDataSource(activeKos.id);
    activeKos = null;
  }
  activeSource = null;
  activeStore = null;

  const fixtureKeys = Object.keys(payload.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  // kOS-feed widgets read from a separate `"kos"` source. Route any key
  // prefixed `kos.` there; everything else (Telemachus telemetry) stays on
  // the `"data"` source.
  const isKosKey = (k: string) => k.startsWith("kos.");
  const kosKeys = fixtureKeys.filter(isKosKey);
  const dataFixtureKeys = fixtureKeys.filter((k) => !isKosKey(k));
  const seriesKeys = payload.series ? Object.keys(payload.series) : [];
  // When series is provided we also need `v.name` + `v.missionTime` in
  // the source schema so the flight detector can mint a current flight
  // (without one, `queryRange` falls back to empty and the seeded
  // samples are invisible to `useDataSeries`).
  const detectorKeys = payload.series ? ["v.name", "v.missionTime"] : [];
  const allKeys = Array.from(
    new Set([...dataFixtureKeys, ...seriesKeys, ...detectorKeys]),
  );
  activeSource = new MockDataSource({
    id: "data",
    keys: allKeys.map((k) => ({ key: k })),
  });
  activeStore = new MemoryStore();
  activeBuffered = new BufferedDataSource({
    source: activeSource,
    store: activeStore,
  });
  registerDataSource(activeBuffered);
  await activeBuffered.connect();

  // Register the unbuffered `kos` source whenever the fixture carries any
  // `kos.` key. Connect it so `status` reads "connected"; its topic-status
  // methods (live on the instance, not behind a buffer wrapper) feed
  // `useKosScriptStatus`.
  if (kosKeys.length > 0) {
    activeKos = new ProbeKosDataSource({
      id: "kos",
      keys: kosKeys.map((k) => ({ key: k })),
    });
    registerDataSource(activeKos);
    await activeKos.connect();
  }

  // Seed the MemoryStore with backfill samples for any keys widgets
  // will call `useDataSeries(key, windowSec)` against. Has to happen
  // *before* widget mount because useDataSeries calls queryRange in
  // its setup effect — by the time the widget commits, samples need
  // to already be in the store. Detector flight has to exist first
  // (otherwise queryRange returns empty), which we trigger by
  // emitting vessel-name + mission-time through the buffered
  // wrapper.
  if (payload.series && activeStore) {
    // Seed the flight identity from the fixture's OWN v.name / v.missionTime
    // when present. If we seeded with a fixed placeholder name while the
    // fixture carried a different v.name, the post-mount emit of the real
    // identity would trip FlightDetector's name-change path and mint a
    // SECOND flight — orphaning these seeded samples under the first flight
    // id. useDataSeries' queryRange then resolves to whichever flight is
    // current when its effect runs, which is effect-timing-dependent and so
    // varies by engine (Chromium found the data; Firefox/WebKit rendered an
    // empty graph). Matching the identity keeps it a single flight, so the
    // seeded samples and the mounted widget's query always agree.
    const seedName =
      typeof payload.fixture["v.name"] === "string"
        ? (payload.fixture["v.name"] as string)
        : "ProbeFlight";
    const seedMissionTime =
      typeof payload.fixture["v.missionTime"] === "number"
        ? (payload.fixture["v.missionTime"] as number)
        : 0;
    activeSource.emit("v.name", seedName);
    activeSource.emit("v.missionTime", seedMissionTime);
    // Microtask lets the buffered handleSample → detector observe
    // path land before we read the current flight.
    await Promise.resolve();
    await Promise.resolve();
    const flight = activeBuffered.getCurrentFlight();
    if (flight) {
      // Fixture sample timestamps are RELATIVE (negative = N ms ago,
      // 0 = now). useDataSeries queries `[now - windowMs, now]` using
      // Date.now() — anchor the seeded samples to wall-clock so the
      // backfill range catches them.
      const wallNow = Date.now();
      for (const [key, samples] of Object.entries(payload.series)) {
        for (const s of samples) {
          await activeStore.appendSample(flight.id, key, wallNow + s.t, s.v);
        }
      }
    }
  }

  // Force-load BOTH locked-font weights before mounting so the very first
  // layout uses JetBrains Mono metrics for regular AND bold text. Awaiting
  // `document.fonts.ready` alone is not enough: it resolves once the fonts
  // currently in the loading set are done, but a weight the layout hasn't
  // requested yet may not be in that set — so in Firefox the 700 face could
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
  // Wrap with a no-op AlarmsLauncherProvider so widgets that opt into
  // alarm chrome (`useAlarmsLauncher` / `useAlarmCreator` /
  // `useAlarmManager`) get a real launcher reference and render their
  // bell affordance. Without the provider those hooks return null and
  // the bell vanishes from harness PNGs even though it's the operator
  // workflow in live use. The launcher / creator / manager fns are
  // probe-only stubs — clicking them does nothing because there's no
  // alarm pipeline in the probe page; but the rendered chrome is the
  // thing we want to verify.
  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(
      AlarmsLauncherProvider,
      {
        launcher: () => {},
        creator: () => {},
        manager: { find: () => null, remove: () => {} },
      },
      createElement(
        DashboardItemContext.Provider,
        { value: { instanceId } },
        createElement(WidgetComponent, {
          config: payload.config ?? def.defaultConfig ?? {},
          id: instanceId,
          w: payload.w,
          h: payload.h,
        }),
      ),
    ),
  );

  // Let React commit + useEffect run (so useDataValue actually subscribes)
  // before we start emitting values.
  await rafTick();

  for (const key of dataFixtureKeys) {
    activeSource.emit(key, payload.fixture[key]);
  }
  if (activeKos) {
    for (const key of kosKeys) {
      activeKos.emit(key, payload.fixture[key]);
    }
  }

  // Two more frames: the first lets React commit the value-driven re-render,
  // the second lets the ResizeObserver-driven dialSize land and re-render.
  await rafTick();
  await rafTick();
  // CSS transitions on transform / opacity can keep moving for a few
  // frames after the React render commits (the heading-strip ticker has
  // `transition: transform 80ms linear`). Without a settle delay the
  // screenshot catches the strip mid-flight, which used to look like a
  // strip-alignment bug. Padding generously past the longest known
  // transition (80ms) keeps the harness deterministic.
  await settle(200);

  // Synthetic clicks fire AFTER the value emit + settle so React state
  // is fully committed before the click handlers run. Each click waits
  // `awaitMs` (default 100ms) so the resulting state change has time
  // to render before the next click / screenshot.
  if (payload.clicks && payload.clicks.length > 0) {
    for (const c of payload.clicks) {
      const el = document.querySelector(c.selector);
      if (!el) {
        throw new Error(`Probe: click selector "${c.selector}" not found`);
      }
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await settle(c.awaitMs ?? 100);
    }
  }
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function settle(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

declare global {
  interface Window {
    __renderProbe: (payload: ProbePayload) => Promise<void>;
  }
}

window.__renderProbe = renderProbe;
