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
import "./goNoGo/GoNoGoComponent"; // app-level component — registers on import
import "./notes/NotesComponent"; // app-level component — registers on import
import App from "./App";
import { setConsentPrompt } from "./uplinks/consent";
import { promptForConsent } from "./uplinks/consentModal";
import { LOADER_UPLINK_IDS, loaderBootIdsOverride } from "./uplinks/flag";
import { hostCompat } from "./uplinks/hostCompat";
import { loadEnabledUplinks } from "./uplinks/loader";
import { localRegistrySource } from "./uplinks/registry";
import { probeUplinkRoster } from "./uplinks/rosterProbe";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);

// The Axiom transport is opt-in and consent-gated — it is NOT installed
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
// registry when the dashboard mounts. Two paths, unconditional (D4 step 2 —
// the loader is no longer flag-gated for the first-party 3):
//
//  - kerbalism + avionics have no runtime-loader bundle/registry entry yet
//    (out of the loader's scope this step), so they stay plain static
//    imports, each self-registering on import.
//  - scansat + kos + kerbcast (`LOADER_UPLINK_IDS`) ALWAYS go through the
//    runtime loader: it fetches + verifies + import()s each standalone
//    bundle, its externals resolving through the baked import map to the
//    app's singletons. With no live roster (dev / e2e / offline first boot)
//    `loadEnabledUplinks` still loads this default set — see
//    `deriveEnabledIds` in loader.ts. `?uplinkLoaderIds=` remains a dev-only
//    override of which ids that boot call attempts (e.g. the Hub-wizard
//    dogfood e2e, which deliberately boots with one id left out).
//
// Either way render proceeds — a quarantined Uplink degrades to "widget not
// loaded (reason)" in Settings, never a blank dashboard.
//
// The two halves run CONCURRENTLY, not sequentially: `probeUplinkRoster()`'s
// system.uplinks read is bounded by its own timeout (default 3000ms) measured
// from the moment it's called, and the roster-vs-fallback boot behaviour
// (`deriveEnabledIds` in loader.ts) is timing-sensitive. Awaiting the
// kerbalism/avionics imports first would needlessly delay the probe's start
// by however long those chunks take to fetch, for no benefit — starting both
// in the same tick keeps the probe's timing independent of the static-import
// half's duration.
async function registerScansatAndRender(): Promise<void> {
  const staticImports = Promise.all([
    import("@ksp-gonogo/kerbalism"),
    import("@ksp-gonogo/avionics"),
  ]);

  // Wire the real modal-backed consent prompt before the loader runs (the
  // store defaults to "deny" until this is set). Renders in the app's active
  // theme so it matches the app it is about to extend.
  setConsentPrompt((info) => promptForConsent(info, activeThemeValue));
  const loaderRun = (async () => {
    try {
      // A bounded read of the live system.uplinks roster so the loader can
      // enforce the three-way mod-hash check; undefined when no mod is talking
      // (dev / offline first boot) → the loader records the mod-hash arm as
      // pending and degrades to the two-way index==bytes check.
      const roster = await probeUplinkRoster();
      await loadEnabledUplinks({
        registrySource: localRegistrySource(),
        enabledIds: loaderBootIdsOverride() ?? [...LOADER_UPLINK_IDS],
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

void registerScansatAndRender();
