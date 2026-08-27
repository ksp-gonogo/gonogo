// MUST be first: installs the injected gonogo host before any static import
// self-registers a facade-sealed Uplink client (see the module's own header).
import "./uplinks/install-host-first";
import {
  ErrorBoundary,
  getTheme,
  registerStockBodies,
  setAppVersion,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { ModalProvider } from "@ksp-gonogo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect imports below trigger self-registration of built-in
// extensions: themes (from @ksp-gonogo/ui), components (from @ksp-gonogo/components),
// and data sources (from ./dataSources).
import "@ksp-gonogo/components"; // triggers all component self-registration
import "./dataSources"; // triggers all data source self-registration
import "./goNoGo/GoNoGoComponent"; // app-level component: registers on import
import "./notes/NotesComponent"; // app-level component: registers on import
import App from "./App";
import { isStationRoute } from "./screens/isStationRoute";
import { setConsentPrompt } from "./uplinks/consent";
import { promptForConsent } from "./uplinks/consentModal";
import { loaderBootIdsOverride } from "./uplinks/flag";
import { hostCompat } from "./uplinks/hostCompat";
import { loadEnabledUplinks } from "./uplinks/loader";
import { localRegistrySource } from "./uplinks/registry";
import { probeUplinkRoster } from "./uplinks/rosterProbe";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);

// The Axiom transport is opt-in and consent-gated, it is NOT installed
// here. The main screen installs/removes it via AnalyticsConsentHost once
// the operator answers the boot consent ask; stations install/remove it
// when the host broadcasts its consent over PeerJS (see StationScreen).
// Console + ring-buffer logging is always on, unaffected by consent.
logger.info(`gonogo v${VERSION} (build ${BUILD_TIME})`);

// Pass the Vite base URL so texture paths resolve correctly under sub-path
// deployments (e.g. /gonogo/bodies/ on GitHub Pages).
registerStockBodies(`${import.meta.env.BASE_URL}bodies`);

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) throw new Error("Could not find root node.");

// Theme registration is a side-effect of importing `@ksp-gonogo/components`
// (above), so by this point `default-dark` is in the registry. A future
// settings UI can swap this for a stateful selection driven by user choice.
const activeTheme = getTheme("default-dark");
if (!activeTheme) throw new Error("default-dark theme failed to register");
const activeThemeValue = activeTheme.theme;
const rootNode = root;

function renderApp(): void {
  createRoot(rootNode).render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider theme={activeThemeValue}>
          <QueryClientProvider client={queryClient}>
            <ModalProvider>
              <App />
            </ModalProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Uplink registration happens before first render so widgets are in the
// registry when the dashboard mounts. Two paths, both unconditional, neither
// behind a flag:
//
//  - kerbalism + avionics + mechjeb + breakingGround have no runtime-loader
//    bundle/registry entry (breakingGround is bundled IN the core mod DLL,
//    same as parts/vessel; the other three are outside the loader's scope), so
//    all four are plain static imports, each self-registering on import.
//  - every Uplink the live `system.uplinks` roster reports installed goes
//    through the runtime loader: it fetches + verifies + import()s each
//    standalone bundle, its externals resolving through the baked import map
//    to the app's singletons. No id is named here, which is the point: a
//    third party's Uplink loads on exactly this path. With no live roster
//    (dev / e2e / offline first boot) nothing is attempted, `?uplinkLoaderIds=`
//    is how you name ids by hand (see `deriveEnabledIds` in loader.ts).
//
// Either way render proceeds, a quarantined Uplink degrades to "widget not
// loaded (reason)" in Settings, never a blank dashboard.
//
// The two halves run CONCURRENTLY, not sequentially: `probeUplinkRoster()`'s
// system.uplinks read is bounded by its own timeout (default 3000ms) measured
// from the moment it's called, and the roster-vs-fallback boot behaviour
// (`deriveEnabledIds` in loader.ts) is timing-sensitive. Awaiting the
// kerbalism/avionics/mechjeb imports first would needlessly delay the
// probe's start by however long those chunks take to fetch, for no benefit,
// starting both in the same tick keeps the probe's timing independent of
// the static-import half's duration.
//
// STATION BOOT (#6, station boot re-sequence, 2026-07-25): a station NEVER
// talks to KSP or an Uplink author host directly, it gets everything from
// the main screen over PeerJS. `probeUplinkRoster()` opens its own direct
// `WebSocketTransport` to KSP and `loadEnabledUplinks`'s default `fetchBytes`
// is a direct `fetch()` of the bundle bytes, both are exactly the
// station→KSP / station→author-host paths the peer architecture forbids. So
// on `/station` this function skips both calls entirely: the static
// (kerbalism/avionics/mechjeb) imports are in-app self-registering imports
// with no network involved, so they stay; the fetch-based runtime loader instead
// runs LATER, inside `StationUplinkLoader`
// (`./uplinks/StationUplinkLoader.tsx`), mounted by `StationScreen` once the
// station is connected to a host and has its own peer-backed
// `TelemetryClient` to read `system.uplinks` off and its own
// `PeerClientService` to route bundle-byte fetches through
// (`createPeerBundleFetcher`, D6). `renderApp()` still runs unconditionally
// here: it mounts `<App>`, which is what renders `StationScreen` at all.
async function bootUplinksAndRender(): Promise<void> {
  const staticImports = Promise.all([
    import("@ksp-gonogo/gonogo-kerbalism-uplink"),
    import("@ksp-gonogo/gonogo-avionics-uplink"),
    import("@ksp-gonogo/gonogo-mechjeb-uplink"),
    // One augment and one Topic registration, no widget of its own: the flight
    // plan appears as a section inside the maneuver planner. Static like the
    // three above because this Uplink ships with the mod, and unconditional
    // because a station has to know `principia.flightPlan` is a Topic to read
    // it off the host at all.
    import("@ksp-gonogo/gonogo-principia-uplink"),
    // Bundled IN the core mod DLL (Gonogo.KSP.BreakingGroundUplink, like
    // PartsUplink/VesselUplink), so its client rides the same "no
    // runtime-loader entry, plain static import" path as kerbalism/avionics
    // above, never the fetch-based loader.
    import("@ksp-gonogo/gonogo-breaking-ground-uplink"),
    // Types and three Topic registrations, no widget and no component
    // registration: the smallest client in the app. It is here because its
    // three channels are runtime registrations from this package rather than
    // static members of the SDK's Topic union. Without this import
    // `isTopicId("comms.linkMargin")` goes false and the replay recorder drops
    // three channels, with nothing else going red. Same "no runtime-loader
    // entry, plain static import" path as the four above, and the cheapest of
    // them to take unconditionally: there is no widget behind it to evaluate.
    import("@ksp-gonogo/gonogo-realantennas-uplink"),
    // RP-1's space centre: ten Topic registrations and its own two unit
    // tokens, plus the augments that read them. Static like the five above
    // because this Uplink ships with the mod, and unconditional because a
    // station has to know `rp1.buildQueue` is a Topic to read it off the host
    // at all. Its channels publish empty on any install without RP-1, which is
    // every stock one.
    import("@ksp-gonogo/gonogo-rp1-uplink"),
    // The aerodynamic state a full-fidelity aerodynamics model computes: one
    // widget, two Topic registrations and two unit tokens of its own. Static
    // like the six above because this Uplink ships with the mod, and
    // unconditional because a station has to know `aero.state` is a Topic to
    // read it off the host at all. Its channel publishes an explicit absence on
    // any install without the model, which is every stock one.
    import("@ksp-gonogo/gonogo-ferram-aerospace-research-uplink"),
  ]);

  // Wire the real modal-backed consent prompt before the loader runs (the
  // store defaults to "deny" until this is set). Renders in the app's active
  // theme so it matches the app it is about to extend. Needed on BOTH
  // screens: a station's deferred `StationUplinkLoader` run still gates its
  // first load on this same consent seam.
  setConsentPrompt((info) => promptForConsent(info, activeThemeValue));

  if (isStationRoute()) {
    // No roster probe, no fetch-based loader here; see the doc comment
    // above. `StationUplinkLoader` runs the equivalent sequence later,
    // post-connect, through the peer conduit.
    await staticImports;
    renderApp();
    return;
  }

  const loaderRun = (async () => {
    try {
      // A bounded read of the live system.uplinks roster so the loader can
      // enforce the three-way mod-hash check; undefined when no mod is talking
      // (dev / offline first boot) → the loader records the mod-hash arm as
      // pending and degrades to the two-way index==bytes check.
      const roster = await probeUplinkRoster();
      await loadEnabledUplinks({
        registrySource: localRegistrySource(),
        // The roster is the only thing that says what to load; an explicit
        // `?uplinkLoaderIds=` wins over it (see LoaderContext.override), and
        // is undefined when unset.
        override: loaderBootIdsOverride(),
        hostCompat,
        appVersion: VERSION,
        roster,
      });
    } catch (err) {
      logger.error(
        "[uplink-loader] loader path threw",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  })();

  await Promise.all([staticImports, loaderRun]);
  renderApp();
}

void bootUplinksAndRender();
