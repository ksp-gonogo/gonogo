/**
 * Dedicated probe for CrewStatus's WIDGET-LEVEL panel badge ("Crew
 * critical" / "N crew critical"), a CONTRIBUTION the Kerbalism Uplink drops
 * into the auto-wired `crew-status.badges` CONTRIBUTION slot
 * (`mod/GonogoKerbalismUplink/client/src/CrewSurvival/badge.ts`). This is a
 * different registry from the per-row `crew-status.badges` AugmentSlot the
 * base widget itself declares in `index.tsx`: same slot NAME, two different
 * mechanisms (contributions vs. augments), see `badge.ts`'s own doc comment.
 *
 * The shared `scripts/probe/probe-entry.tsx` (used by every other widget's
 * review render AND the visual-gate baselines) deliberately never mounts
 * `PanelBadgesProvider`, see that file's own top comment: wiring it in there
 * would risk changing ShipSystems'/SpaceWeather's baselines too (they also
 * contribute panel badges) for a concern only this one render needs. This
 * probe is a narrow, standalone copy of the real chain
 * `GridItemContent.tsx` wires (WidgetMetaContext -> ContributionsProvider ->
 * useWidgetBadges -> PanelBadgesProvider -> Panel), scoped to CrewStatus
 * only, mirroring `provenance-card-probe`'s pattern of a dedicated probe for
 * a concern the shared harness can't show, and `panel-badge.test.tsx`'s own
 * three-layer wiring (this is that same chain, rendered to a PNG instead of
 * asserted against `screen`).
 */
// MUST be the first import: installs the injected gonogo host before the
// `@ksp-gonogo/gonogo-kerbalism-uplink` side-effect import below self-registers a
// facade-sealed Uplink client (which would otherwise throw "the gonogo host
// has not been installed" at module load). ES imports are hoisted in source
// order, mirrors `probe-entry.tsx`'s own ordering requirement.
import "../probe/probe-install-host";
import {
  type ComponentProps,
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  registerStockBodies,
  useWidgetBadges,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
// Side-effect import: the Kerbalism Uplink's widgets AND its crew-survival
// panel-badge contribution (`badge.ts`) self-register on module load.
import "@ksp-gonogo/gonogo-kerbalism-uplink";
import { defaultDarkTheme, PanelBadgesProvider } from "@ksp-gonogo/ui-kit";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect import: every built-in widget (CrewStatus included)
// self-registers on module load, same contract as the shared probe.
import "../../src";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";

registerStockBodies();

export interface CrewBadgeProbeEmit {
  channel: string;
  value: unknown;
}

export interface CrewBadgeProbePayload {
  /** Topics the fixture carries; forwarded to `setupStreamFixture`. */
  carriedChannels: string[];
  /** UT to pin the view clock at; forwarded to `setupStreamFixture`. */
  pinnedUt?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: CrewBadgeProbeEmit[];
  /** Grid units passed to the widget (`w`/`h` props), gates its roster branch. */
  w: number;
  h: number;
  /** Pixel box the probe container is sized to. */
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

/**
 * Verbatim mirror of `GridItemContent.tsx`'s own `WidgetBadges`: feeds the
 * widget's automatic `<componentId>.badges` contribution slot to whatever
 * `Panel` it renders. Mounted INSIDE `WidgetContributions`'s provider stack
 * so `useWidgetBadges` has a `ContributionsProvider` above it.
 */
function WidgetBadges({ children }: { children: ReactNode }) {
  const badges = useWidgetBadges();
  return createElement(PanelBadgesProvider, { badges }, children);
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** See `probe-entry.tsx`'s own doc comment on this same helper: `StubTransport.emit`
 *  drops a sample for a topic nothing has subscribed to yet, and the widget
 *  subscribes inside a React passive effect a single `rafTick` can't be relied
 *  on to have flushed. Polling here makes fixture replay deterministic. */
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

async function renderCrewBadgeProbe(
  payload: CrewBadgeProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Crew-badge probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  // See `probe-entry.tsx`'s own comment on why this reset matters across
  // repeated `renderCrewBadgeProbe` calls in one page (Processor evaluator's
  // module-global cache keyed by frame generation, which restarts at 0 for
  // every fresh `setupStreamFixture` TimelineStore).
  clearProcessorRuntime();

  const def = getComponent("crew-status");
  if (!def) {
    throw new Error('Crew-badge probe: "crew-status" not registered');
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

  // Same rationale as `probe-entry.tsx`: force-load both weights before the
  // first layout so bold badge/panel-title text uses real JetBrains Mono
  // metrics from the first paint, not a taller fallback.
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

  // Let React commit + useEffect run (so useStream/useTelemetry actually
  // subscribe) before replaying the fixture.
  await rafTick();

  for (const e of payload.emits) {
    await waitForSubscription(streamFixture.transport, e.channel);
    streamFixture.emit(e.channel, e.value);
    await rafTick();
  }

  await rafTick();
  await rafTick();
  await settle(200);
}

declare global {
  interface Window {
    __renderCrewBadgeProbe: (payload: CrewBadgeProbePayload) => Promise<void>;
  }
}

window.__renderCrewBadgeProbe = renderCrewBadgeProbe;
