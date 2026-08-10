/**
 * Dedicated probe for CrewManifest's `crew-manifest.avatar` slot: shows the
 * avatar-LEFT-of-the-WHOLE-block layout (avatar column | name + wrapping
 * badge + survival meters stacked to its right) that the normal widget
 * probe/visual-gate harness never exercises, no avatar-providing Uplink is
 * registered there (`probe-entry.tsx`'s own top comment lists exactly the
 * two mod clients it side-effect-imports, kOS and Kerbalism; kerbcast is
 * neither).
 *
 * Mirrors `crew-badge-probe-entry.tsx`'s own pattern (a narrow, standalone
 * copy of the real composition chain, scoped to CrewManifest only) but adds
 * ONE thing that probe doesn't: a stub `crew-manifest.avatar` augment,
 * registered before mount, standing in for the real
 * `mod/GonogoKerbcastUplink/client/src/CrewAvatarGate` augment (a live
 * facecam feed the probe harness has no camera to source). The stub renders
 * a plain initials box, not a real image, this render exists to prove the
 * ROW LAYOUT (avatar column spanning the block), not to preview kerbcast's
 * own facecam chrome.
 *
 * Replays the same `crew-critical.json` fixture the panel-badge probe uses
 * (Jebediah's radiation dose + Bill's death clock both cross "nogo"), so
 * this render shows the avatar column alongside a REAL per-row badge +
 * survival meter, not an empty slot, the actual case the operator flagged:
 * "the badge renders awkwardly lower" when the avatar sat next to the name
 * only.
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
  registerAugment,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
// Side-effect import: the Kerbalism Uplink's crew-survival augment (per-row
// badges + meters, `crew-manifest.survival`) self-registers on module load.
// Its SEPARATE panel-level "N crew critical" contribution also registers
// here but is deliberately never surfaced by this probe (no
// ContributionsProvider->useWidgetBadges->PanelBadgesProvider chain, unlike
// `crew-badge-probe-entry.tsx`): that header chip is a different mechanism
// (contributions, not augments) testing a different concern (panel chrome,
// not the per-row avatar/badge/meter block this probe exists to show), and
// at this probe's grid-formula tile widths it visually squeezes the panel
// title, a distraction unrelated to the row layout being rendered here.
import "@ksp-gonogo/gonogo-kerbalism-uplink";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect import: every built-in widget (CrewManifest included)
// self-registers on module load, same contract as the shared probe.
import "../../src";
import type { CrewAvatarContext } from "../../src/CrewManifest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../../src/test/setupStreamFixture";

registerStockBodies();

/**
 * Stub `crew-manifest.avatar` augment: a plain initials box standing in for
 * a real facecam feed (kerbcast's `KerbcastAvatarAugment`, not available in
 * this headless probe). `requires` is deliberately omitted, this render is
 * about the row-layout composition, not Domain presence gating, which the
 * dedicated `avatar slot` unit tests already cover.
 */
function StubAvatar({ crewName }: CrewAvatarContext) {
  // First two letters of the GIVEN name only, not first+surname initials:
  // KSP's stock roster shares "Kerman" across most kerbals, so a
  // first-letter-of-each-word scheme collides constantly (Bill Kerman and
  // Bob Kerman both landing on "BK"). This probe exists to show the row
  // LAYOUT, distinguishable placeholders make that easier to read at a
  // glance; a real avatar (kerbcast's facecam) has no such collision.
  const given = crewName.split(" ").filter(Boolean)[0] ?? "";
  const initials = given.slice(0, 2).toUpperCase() || "?";
  return createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "linear-gradient(135deg, #35507a, #182437)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-primary)",
        fontWeight: 700,
        fontSize: "0.95em",
        letterSpacing: "0.02em",
      },
    },
    initials,
  );
}

registerAugment<"crew-manifest.avatar">({
  id: "probe-crew-avatar-stub",
  augments: "crew-manifest.avatar",
  component: StubAvatar,
});

export interface CrewAvatarProbeEmit {
  channel: string;
  value: unknown;
}

export interface CrewAvatarProbePayload {
  /** Topics the fixture carries; forwarded to `setupStreamFixture`. */
  carriedChannels: string[];
  /** UT to pin the view clock at; forwarded to `setupStreamFixture`. */
  pinnedUt?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: CrewAvatarProbeEmit[];
  /** Grid units passed to the widget (`w`/`h` props), gates its roster branch. */
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

async function renderCrewAvatarProbe(
  payload: CrewAvatarProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Crew-avatar probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  // See `probe-entry.tsx`'s own comment on why this reset matters across
  // repeated render calls in one page (Processor evaluator's module-global
  // cache keyed by frame generation, which restarts at 0 for every fresh
  // `setupStreamFixture` TimelineStore).
  clearProcessorRuntime();

  const def = getComponent("crew-manifest");
  if (!def) {
    throw new Error('Crew-avatar probe: "crew-manifest" not registered');
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
    __renderCrewAvatarProbe: (payload: CrewAvatarProbePayload) => Promise<void>;
  }
}

window.__renderCrewAvatarProbe = renderCrewAvatarProbe;
