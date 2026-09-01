// MUST be first: installs the injected gonogo host before anything that can
// reach for it runs (see the module's own header).
import "./uplinks/install-host-first";
import {
  ErrorBoundary,
  getTheme,
  registerStockBodies,
  setAppVersion,
} from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { ModalProvider } from "@ksp-gonogo/ui";
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
          <ModalProvider>
            <App />
          </ModalProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Uplink registration happens before first render so widgets are in the
// registry when the dashboard mounts. ONE path, and no id named here, which is
// the point: every Uplink loads exactly the way a third party's does. The
// loader fetches, verifies and `import()`s each standalone bundle the live
// `system.uplinks` roster reports installed, its externals resolving through
// the baked import map to the app's singletons. With no live roster (dev /
// e2e / offline first boot) nothing is attempted; `?uplinkLoaderIds=` is how
// you name ids by hand (see `deriveEnabledIds` in loader.ts).
//
// There used to be a second path: nine build-time `import()`s of Uplink client
// packages, taken because those clients ship alongside the app. That is a
// privilege an outside author cannot reach, since a static import means being
// inside this build, and it made the app's Uplink support two-tier. The reason
// given for it was bootstrap timing on a station, and the timing was already
// handled: `StationUplinkLoader` gates the Dashboard until the load settles,
// and the SDK's runtime Topic registry is subscribable so a Topic registered
// after the provider mounted is carried anyway
// (`carried-channels-uplink.test.tsx` asserts exactly that).
//
// Render proceeds either way: a quarantined Uplink degrades to "widget not
// loaded (reason)" in Settings, never a blank dashboard.
//
// The roster probe and the loader run as one sequence because the loader needs
// the roster. `probeUplinkRoster()`'s read is bounded by its own timeout
// (default 3000ms), so a mod that never answers delays the first render by
// that much and no more.
//
// STATION BOOT (#6, station boot re-sequence, 2026-07-25): a station NEVER
// talks to KSP or an Uplink author host directly, it gets everything from the
// main screen over PeerJS. `probeUplinkRoster()` opens its own direct
// `WebSocketTransport` to KSP and `loadEnabledUplinks`'s default `fetchBytes`
// is a direct `fetch()` of the bundle bytes, both exactly the station→KSP /
// station→author-host paths the peer architecture forbids. So on `/station`
// this function skips both entirely and renders straight away; the loader
// instead runs LATER, inside `StationUplinkLoader`
// (`./uplinks/StationUplinkLoader.tsx`), mounted by `StationScreen` once the
// station is connected to a host and has its own peer-backed
// `TelemetryClient` to read `system.uplinks` off and its own
// `PeerClientService` to route bundle-byte fetches through
// (`createPeerBundleFetcher`, D6). `renderApp()` still runs unconditionally
// here: it mounts `<App>`, which is what renders `StationScreen` at all.
async function bootUplinksAndRender(): Promise<void> {
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
    renderApp();
    return;
  }

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

  renderApp();
}

void bootUplinksAndRender();
