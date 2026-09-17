import "../probe/probe-install-host";
import {
  type ComponentProps,
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  useWidgetBadges,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
import { defaultDarkTheme, PanelBadgesProvider } from "@ksp-gonogo/ui-kit";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import "../../src";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";

export interface CommSignalBadgeProbeEmit {
  channel: string;
  value: unknown;
}

export interface CommSignalBadgeProbePayload {
  carriedChannels: string[];
  pinnedUt?: number;
  emits: CommSignalBadgeProbeEmit[];
  disconnect?: boolean;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

function WidgetBadges({ children }: { children: ReactNode }) {
  const badges = useWidgetBadges();
  return createElement(PanelBadgesProvider, { badges }, children);
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

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

async function renderCommSignalBadgeProbe(
  payload: CommSignalBadgeProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("CommSignal-badge probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  clearProcessorRuntime();

  const def = getComponent("comm-signal");
  if (!def) {
    throw new Error('CommSignal-badge probe: "comm-signal" not registered');
  }
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
              WidgetBadges,
              null,
              createElement(
                DashboardItemContext.Provider,
                { value: { instanceId: "probe" } },
                createElement(WidgetComponent, {
                  config: def.defaultConfig ?? {},
                  id: "probe",
                  w: payload.w,
                  h: payload.h,
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  await rafTick();

  for (const e of payload.emits) {
    await waitForSubscription(streamFixture.transport, e.channel);
    streamFixture.emit(e.channel, e.value);
    await rafTick();
  }

  if (payload.disconnect) {
    streamFixture.store.setTransportConnected(false);
    streamFixture.store.beginFrame();
    await rafTick();
  }

  await rafTick();
  await rafTick();
  await settle(200);
}

declare global {
  interface Window {
    __renderCommSignalBadgeProbe: (
      payload: CommSignalBadgeProbePayload,
    ) => Promise<void>;
  }
}

window.__renderCommSignalBadgeProbe = renderCommSignalBadgeProbe;
