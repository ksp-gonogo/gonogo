/**
 * Animation-capture probe entry for widgets whose rendered content depends
 * on a mod-client Uplink's contribution, not just the built-in library.
 * Otherwise identical to `capture-entry.tsx` (real live clock, one
 * `TelemetryProvider` carrying every topic): see that file's own doc comment
 * for the mechanics this mirrors.
 *
 * `capture-entry.tsx` deliberately skips the Uplink facade ("nothing this
 * harness captures needs [it]"); this variant exists for the opposite case,
 * e.g. SystemView's CME overlay, contributed by `@ksp-gonogo/
 * gonogo-kerbalism-uplink` onto the built-in `system-view.entities` slot.
 * `./probe-install-host` MUST be the first import, ahead of the Uplink
 * client import: that client calls the facade's `registerContribution` at
 * module load, which throws "the gonogo host has not been installed"
 * without it (same ordering constraint `probe-entry.tsx` documents).
 */
import "./probe-install-host";
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
// Side-effect import: the Kerbalism Uplink's contributions (including the
// SystemView CME overlay) self-register on module load, same contract as
// the built-in widget library below.
import "@ksp-gonogo/gonogo-kerbalism-uplink";
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
  /** UT-per-wall-second slope for THIS capture's clock; defaults to 1. See
   *  `capture-entry.tsx`'s own doc comment for the traffic-vs-orbit tradeoff;
   *  the CME capture stays at real time throughout. */
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

/** Re-emit on the CURRENTLY mounted capture's transport, the driver's hook
 *  for updating a topic mid-recording (e.g. a storm's `stormState`
 *  transitioning from inbound to in-progress). No-op if nothing is mounted
 *  or the topic has no subscriber yet. */
function captureEmit(topic: string, value: unknown): void {
  activeTransport?.emit(topic, value);
}

/** The mounted clock's current TrueNow estimate. `null` before anything is
 *  mounted. */
function captureUtNow(): number | null {
  const estimate = activeClock?.utNowEstimate();
  return estimate !== undefined && Number.isFinite(estimate) ? estimate : null;
}

declare global {
  interface Window {
    __renderCapture: (payload: CapturePayload) => Promise<void>;
    __captureEmit: (topic: string, value: unknown) => void;
    __captureUtNow: () => number | null;
  }
}

window.__renderCapture = renderCapture;
window.__captureEmit = captureEmit;
window.__captureUtNow = captureUtNow;
