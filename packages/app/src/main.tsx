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
// kOS and SCANsat are normally bundled static imports. Behind the Uplink-loader
// flag they are instead loaded at runtime as standalone ESM bundles (see
// ./uplinks) — the static imports stay the default/fallback path (moved into the
// else branch of registerScansatAndRender so they don't ALSO run under the flag);
// the loaded path is ADDITIVE and must never displace the fallback until it is
// proven on all three engines.
import "./dataSources"; // triggers all data source self-registration
import "./goNoGo/GoNoGoComponent"; // app-level component — registers on import
import "./notes/NotesComponent"; // app-level component — registers on import
import App from "./App";
import { setConsentPrompt } from "./uplinks/consent";
import { promptForConsent } from "./uplinks/consentModal";
import { LOADER_UPLINK_IDS, uplinkLoaderEnabled } from "./uplinks/flag";
import { installGonogoHost } from "./uplinks/host";
import { hostCompat } from "./uplinks/hostCompat";
import { loadEnabledUplinks } from "./uplinks/loader";
import { localRegistrySource } from "./uplinks/registry";
import { probeUplinkRoster } from "./uplinks/rosterProbe";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);

// Install the injected SDK host once at boot, before any Uplink bundle is
// import()ed (design §2.2c). Inert on the bundled path — nothing reads the host
// global unless a runtime-loaded Uplink resolves the sdk facade to it.
installGonogoHost();

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

// SCANsat registration happens before first render so the widget is in the
// registry when the dashboard mounts. Default path: bundled static import. Flagged
// path (`?uplinkLoader=1`): the runtime loader fetches + verifies + import()s the
// standalone bundle, its externals resolving through the baked import map to the
// app's singletons. Either way render proceeds — a quarantined Uplink degrades to
// "widget not loaded (reason)" in Settings, never a blank dashboard.
async function registerScansatAndRender(): Promise<void> {
  if (uplinkLoaderEnabled()) {
    // Wire the real modal-backed consent prompt before the loader runs (the
    // store defaults to "deny" until this is set). Renders in the app's active
    // theme so it matches the app it is about to extend.
    setConsentPrompt((info) => promptForConsent(info, activeThemeValue));
    try {
      // A bounded read of the live system.uplinks roster so the loader can
      // enforce the three-way mod-hash check; undefined when no mod is talking
      // (dev / offline first boot) → the loader records the mod-hash arm as
      // pending and degrades to the two-way index==bytes check.
      const roster = await probeUplinkRoster();
      await loadEnabledUplinks({
        registrySource: localRegistrySource(),
        enabledIds: [...LOADER_UPLINK_IDS],
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
  } else {
    // Bundled fallback path (flag off): both clients as plain static imports,
    // each self-registering on import. Kept until the loaded path is proven on
    // all three engines (design R9).
    await Promise.all([
      import("@ksp-gonogo/kos"),
      import("@ksp-gonogo/scansat"),
    ]);
  }
  renderApp();
}

void registerScansatAndRender();
