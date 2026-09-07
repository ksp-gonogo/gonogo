/**
 * Dedicated probe for Targeting's docking HUD, with and without a
 * `targeting.camera` backdrop.
 *
 * The standard widget probe cannot show the backdrop at all: the only augment
 * that fills that slot is a camera Uplink's, which ships from its own
 * repository and needs a live WebRTC feed, so `probe-entry.tsx` renders the
 * HUD with an empty slot however the widget is configured. This probe
 * registers a STUB backdrop in its place, on the same slot, with the same
 * structural style the real augment uses (`position: absolute; inset: 0;
 * object-fit: cover; opacity: 0.55`), so the render shows where a video layer
 * lands rather than what any particular camera's picture looks like.
 *
 * Both states come off one page: the stub is registered unconditionally and the
 * widget's `hudMode` config decides whether the slot is mounted at all, which
 * is the same switch an operator flips in the config form. That keeps the two
 * renders comparable, because nothing but the config differs between them.
 */
// MUST be the first import: installs the injected gonogo host before the
// Uplink side-effect imports pulled in by `../../src` can self-register a
// facade-sealed client (which would otherwise throw "the gonogo host has not
// been installed" at module load). ES imports are hoisted in source order.
import "../probe/probe-install-host";
import {
  type ComponentProps,
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  registerAugment,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect import: every built-in widget (Targeting included)
// self-registers on module load, same contract as the shared probe.
import "../../src";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";

registerStockBodies();

/**
 * Stub `targeting.camera` backdrop: a flat approach view standing in for the
 * live docking camera this headless probe has no source for. Styled exactly as
 * the real augment's `<video>` is, so the render answers where the video layer
 * sits and how much of the frame it fills, and answers nothing about any
 * particular camera's picture.
 */
function StubDockingCamera() {
  return createElement("div", {
    "data-stub-camera": "",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      opacity: 0.55,
      background:
        "radial-gradient(circle at 52% 46%, #6f7d8c 0%, #3b4652 26%, #1b222b 55%, #0a0d12 100%)",
    },
  });
}

registerAugment<"targeting.camera">({
  id: "probe-targeting-camera-stub",
  augments: "targeting.camera",
  component: StubDockingCamera,
});

export interface TargetingHudProbeEmit {
  channel: string;
  value: unknown;
}

export interface TargetingHudProbePayload {
  /** Topics the fixture carries; forwarded to `setupStreamFixture`. */
  carriedChannels: string[];
  /** UT to pin the view clock at; forwarded to `setupStreamFixture`. */
  pinnedUt?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: TargetingHudProbeEmit[];
  /** Widget config for this render; `hudMode` is what mounts the camera slot. */
  config: Record<string, unknown>;
  /** Grid units passed to the widget (`w`/`h` props), gate its layout branches. */
  w: number;
  h: number;
  /** Pixel box the probe container is sized to. */
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** See `probe-entry.tsx`'s own doc comment on this same helper. */
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

async function renderTargetingHudProbe(
  payload: TargetingHudProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Targeting-HUD probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  /* See `probe-entry.tsx`'s own comment on why this reset matters across
     repeated render calls in one page: the Processor evaluator's module-global
     cache is keyed by frame generation, which restarts at 0 for every fresh
     `setupStreamFixture` TimelineStore. */
  clearProcessorRuntime();

  const def = getComponent("targeting");
  if (!def) throw new Error('Targeting-HUD probe: "targeting" not registered');
  const WidgetComponent = def.component as React.ComponentType<
    ComponentProps<Record<string, unknown>>
  >;

  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.overflow = "hidden";
  root.style.background = "var(--color-surface-app)";

  const streamFixture: StreamFixture = setupStreamFixture({
    carriedChannels: payload.carriedChannels,
    pinnedUt: payload.pinnedUt,
  });

  /* Same rationale as `probe-entry.tsx`: force-load both weights before the
     first layout so bold panel-title text uses real JetBrains Mono metrics
     from the first paint, not a taller fallback. */
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load('400 1em "JetBrains Mono"'),
      document.fonts.load('700 1em "JetBrains Mono"'),
    ]);
    await document.fonts.ready;
  }

  const meta = {
    componentId: def.id,
    contributionSlots: def.contributionSlots ?? [],
  };

  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(
      ThemeProvider,
      { theme: defaultDarkTheme },
      createElement(
        streamFixture.Provider,
        null,
        createElement(
          WidgetMetaContext.Provider,
          { value: meta },
          createElement(
            ContributionsProvider,
            null,
            createElement(
              DashboardItemContext.Provider,
              { value: { instanceId: "probe" } },
              createElement(WidgetComponent, {
                config: payload.config,
                id: "probe",
                w: payload.w,
                h: payload.h,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // Let React commit + useEffect run (so useTelemetry actually subscribes)
  // before replaying the fixture.
  await rafTick();

  for (const e of payload.emits) {
    await waitForSubscription(streamFixture.transport, e.channel);
    streamFixture.emit(e.channel, e.value);
    await rafTick();
  }

  /* The HUD is reached by a mode EFFECT that runs off the emitted distance
     (tracking -> approach -> docking-hud), so the render needs frames after
     the last emit for those transitions to land, not just after the mount. */
  await rafTick();
  await rafTick();
  await settle(250);
}

declare global {
  interface Window {
    __renderTargetingHudProbe: (
      payload: TargetingHudProbePayload,
    ) => Promise<void>;
  }
}

window.__renderTargetingHudProbe = renderTargetingHudProbe;
