/**
 * Animation-capture probe entry: mounts a widget with a REAL, live-ticking
 * clock, unlike `probe-entry.tsx`'s deterministic `Date.now`-pinned mount,
 * so time-driven visuals (the SystemView command-traffic pulses) actually
 * move frame to frame while a Playwright video recording runs. Kept as its
 * own bundle, entirely separate from `probe-entry.tsx`: the deterministic
 * PNG/visual-gate path never imports or depends on anything in this file.
 *
 * A single live `TelemetryProvider` carries EVERY topic, mirroring
 * `setupStreamFixture` (the widgets' own stream test-adapter, see
 * `selection.integration.test.tsx`/`commsTraffic.integration.test.tsx` for
 * the pattern this borrows): SystemView's `useTelemetry("vessel.orbit")`
 * etc. are single-arg TOPIC reads, routed through whichever
 * `TelemetryClient` is mounted, never the legacy `MockDataSource` registry.
 * The one difference from `setupStreamFixture`: this `ViewClock` uses its
 * own default `nowWall` (real wall time), never scrubbed, so
 * `useViewUt`/`useUtNow` both advance every animation frame for the whole
 * capture instead of sitting pinned.
 *
 * Only registers the built-in widget library (`../../src`), not the
 * mod-client Uplinks `probe-entry.tsx` also pulls in: nothing this harness
 * captures needs the Uplink facade, so the facade-install bridge
 * (`probe-install-host.ts`) is skipped entirely.
 */
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect import: every built-in widget self-registers on module load.
import "../../src";
import { AlarmsLauncherProvider } from "../../src/shared/AlarmsLauncher";

registerStockBodies();

/** One `StubTransport.emit(topic, value)` call, replayed after mount (or,
 *  for a repeating entry, on the interval the driver schedules). */
export interface CaptureStreamEmit {
  topic: string;
  value: unknown;
}

export interface CapturePayload {
  widgetId: string;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  config?: Record<string, unknown>;
  /** Topics to promote into the live TelemetryProvider's carried-channels allowlist. */
  carriedChannels: string[];
  /** Replayed once, in order, right after the live provider mounts. */
  streamEmits: CaptureStreamEmit[];
  /**
   * UT-per-wall-second slope for THIS capture's clock. Defaults to 1 (real
   * time), the setting a traffic-pulse capture needs (a pulse's leg length
   * is a real `oneWaySeconds`, so it must animate at 1 UT-second per real
   * second to read as smooth motion). An orbit-tracking capture instead
   * wants this elevated so a few real seconds of recording cover enough
   * orbital motion to be visible.
   */
  warpRate?: number;
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Mirrors `probe-entry.tsx`'s own `waitForSubscription`: `StubTransport.emit`
 *  drops a sample for a topic nothing has subscribed to yet, and the widget
 *  subscribes inside a passive effect a single `rafTick` can't reliably wait
 *  out. */
async function waitForSubscription(
  transport: { isSubscribed(topic: string): boolean },
  topic: string,
  maxFrames = 60,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (transport.isSubscribed(topic)) return;
    await rafTick();
  }
}

let activeRoot: ReturnType<typeof createRoot> | null = null;
let activeTransport: StubTransport | null = null;
let activeClock: ViewClock | null = null;

async function renderCapture(payload: CapturePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Capture: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }

  // Real live clock: no `nowWall` override (defaults to `performance.now() /
  // 1000`, real wall time), no `scrubTo`, so `useViewUt`/`useUtNow` both
  // advance every animation frame for the whole capture.
  const transport = new StubTransport();
  activeTransport = transport;
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    warpRate: () => payload.warpRate ?? 1,
    delaySeconds: () => 0,
  });
  activeClock = clock;
  const timelineStore = new TimelineStore(clock, {});

  const def = getComponent(payload.widgetId);
  if (!def) {
    throw new Error(`Capture: widget "${payload.widgetId}" not registered`);
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

  const meta = {
    componentId: def.id,
    contributionSlots: def.contributionSlots ?? [],
  };

  const tree = createElement(
    ThemeProvider,
    { theme: defaultDarkTheme },
    createElement(
      TelemetryProvider,
      {
        client,
        store: timelineStore,
        carriedChannels: payload.carriedChannels,
      },
      createElement(
        WidgetMetaContext.Provider,
        { value: meta },
        createElement(
          ContributionsProvider,
          null,
          createElement(
            AlarmsLauncherProvider,
            {
              launcher: () => {},
              creator: () => {},
              manager: { find: () => null, remove: () => {} },
            },
            createElement(
              DashboardItemContext.Provider,
              { value: { instanceId: "capture" } },
              createElement(WidgetComponent, {
                config: payload.config ?? def.defaultConfig ?? {},
                id: "capture",
                w: payload.w,
                h: payload.h,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  activeRoot = createRoot(root);
  activeRoot.render(tree);

  // Let React commit + effects run so useTelemetry/useLatestValue actually
  // subscribe before anything emits.
  await rafTick();

  for (const e of payload.streamEmits) {
    await waitForSubscription(transport, e.topic);
    transport.emit(e.topic, e.value);
    await rafTick();
  }

  await rafTick();
}

/** Re-emit on the CURRENTLY mounted capture's transport: the driver's hook
 *  for keeping traffic flowing across a long recording (e.g. re-dispatching
 *  `system.uplink.pending` with a fresh `dispatchedAt` every few seconds so
 *  the video shows more than one pulse cycle). No-op if nothing is mounted
 *  or the topic has no subscriber yet. */
function captureEmit(topic: string, value: unknown): void {
  activeTransport?.emit(topic, value);
}

let liveSampleTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts a repeating re-emit of `emits`, each tick stamped with the
 * mounted clock's OWN current `(wall, utNowEstimate)` pair as
 * `deliveredAt`/`validAt`. `useViewUt()` (what `SystemDiagram` positions
 * body/vessel dots from) is the CONFIRMED view: it only advances as far as
 * the max `validAt` any delivered sample has actually claimed
 * (`confirmedEdgeUt`'s clamp), so a single one-shot emit at mount leaves it
 * pinned forever, however fast the clock's `warpRate` runs. Repeatedly
 * re-stamping the SAME payloads at the clock's own current estimate keeps
 * the confirmed edge glued to it, the same way a live mod connection's
 * steady sample stream would, so orbital motion actually animates for an
 * orbit-tracking capture. Idempotent: a second call replaces the first.
 */
function startLiveSamples(
  emits: CaptureStreamEmit[],
  intervalMs: number,
): void {
  if (liveSampleTimer !== null) clearInterval(liveSampleTimer);
  liveSampleTimer = setInterval(() => {
    const clock = activeClock;
    const transport = activeTransport;
    if (!clock || !transport) return;
    const validAt = clock.utNowEstimate();
    if (!Number.isFinite(validAt)) return;
    const deliveredAt = performance.now() / 1000;
    for (const e of emits) {
      transport.emit(e.topic, e.value, { validAt, deliveredAt });
    }
  }, intervalMs);
}

/** The mounted clock's current TrueNow estimate (`useUtNow()`'s own read):
 *  lets the driver build a `system.uplink.pending` entry's `dispatchedAt`
 *  relative to what the clock ACTUALLY reports, rather than guessing at the
 *  UT<->wall anchor `observeSample` establishes internally. `null` before
 *  anything is mounted. */
function captureUtNow(): number | null {
  const estimate = activeClock?.utNowEstimate();
  return estimate !== undefined && Number.isFinite(estimate) ? estimate : null;
}

declare global {
  interface Window {
    __renderCapture: (payload: CapturePayload) => Promise<void>;
    __captureEmit: (topic: string, value: unknown) => void;
    __captureUtNow: () => number | null;
    __captureStartLiveSamples: (
      emits: CaptureStreamEmit[],
      intervalMs: number,
    ) => void;
  }
}

window.__renderCapture = renderCapture;
window.__captureEmit = captureEmit;
window.__captureUtNow = captureUtNow;
window.__captureStartLiveSamples = startLiveSamples;
