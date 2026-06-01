import {
  ErrorBoundary,
  getDataSource,
  getTheme,
  registerStockBodies,
  setAppVersion,
} from "@gonogo/core";
import { logger } from "@gonogo/logger";
import { ModalProvider } from "@gonogo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
// Side-effect imports below trigger self-registration of built-in
// extensions: themes (from @gonogo/ui), components (from @gonogo/components),
// and data sources (from ./dataSources).
import "@gonogo/components"; // triggers all component self-registration
import "./dataSources"; // triggers all data source self-registration
import "./goNoGo/GoNoGoComponent"; // app-level component — registers on import
import "./notes/NotesComponent"; // app-level component — registers on import
import App from "./App";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);

// The Axiom transport is opt-in and consent-gated — it is NOT installed
// here. The main screen installs/removes it via AnalyticsConsentHost once
// the operator answers the boot consent ask; stations install/remove it
// when the host broadcasts its consent over PeerJS (see StationScreen).
// Console + ring-buffer logging is always on, unaffected by consent.
logger.info(`gonogo v${VERSION} (build ${BUILD_TIME})`);

// Test + console-debug helper. Subscribes once to a key on the
// "data" source, resolves with the first received value, then unsubs.
// If the cached subscriber already had a value the resolve is
// synchronous-ish (next microtask). Used by the multi-screen Playwright
// tests to read live telemetry without driving widget DOM; also handy
// from the browser console for quick "what's v.body right now?" checks.
if (typeof window !== "undefined") {
  (
    window as unknown as {
      __gonogo_get_value__?: (key: string) => Promise<unknown>;
    }
  ).__gonogo_get_value__ = (key: string) =>
    new Promise((resolve) => {
      const source = getDataSource("data");
      if (!source) {
        resolve(undefined);
        return;
      }
      let settled = false;
      // `unsub` is declared as a let so the callback below can call it
      // without a TDZ — `source.subscribe()` may fire the callback
      // *synchronously* when the buffered wrapper replays a cached
      // value, which would reference the unsub binding before it's
      // assigned if we tried `const unsub = source.subscribe(...)`.
      let unsub: (() => void) | null = null;
      const cb = (value: unknown) => {
        if (settled) return;
        settled = true;
        unsub?.();
        resolve(value);
      };
      unsub = source.subscribe(key, cb);
      // If subscribe fired the callback synchronously (cached replay),
      // unsub was null at the time; call it now that it's set so we
      // don't leak the subscriber.
      if (settled) unsub();
    });
}

// Pass the Vite base URL so texture paths resolve correctly under sub-path
// deployments (e.g. /gonogo/bodies/ on GitHub Pages).
registerStockBodies(`${import.meta.env.BASE_URL}bodies`);

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) throw new Error("Could not find root node.");

// Theme registration is a side-effect of importing `@gonogo/components`
// (above), so by this point `default-dark` is in the registry. A future
// settings UI can swap this for a stateful selection driven by user choice.
const activeTheme = getTheme("default-dark");
if (!activeTheme) throw new Error("default-dark theme failed to register");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider theme={activeTheme.theme}>
        <QueryClientProvider client={queryClient}>
          <ModalProvider>
            <App />
          </ModalProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
