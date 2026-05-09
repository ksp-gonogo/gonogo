import {
  ErrorBoundary,
  getTheme,
  registerStockBodies,
  setAppVersion,
} from "@gonogo/core";
import { AxiomTransport, logger } from "@gonogo/logger";
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
import "./streamSources"; // triggers all stream source self-registration
import App from "./App";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);

// Ship logs to Axiom when the build was given an ingest token. Console
// output is unchanged — this is purely additive. Without env vars, no
// transport is installed, so dev/test/CI never hit Axiom.
const axiomToken = import.meta.env.VITE_AXIOM_TOKEN;
const axiomDataset = import.meta.env.VITE_AXIOM_DATASET ?? "gonogo";
if (axiomToken) {
  logger.addTransport(
    new AxiomTransport({
      token: axiomToken,
      dataset: axiomDataset,
      url: import.meta.env.VITE_AXIOM_URL,
      orgId: import.meta.env.VITE_AXIOM_ORG_ID,
    }),
  );
}

logger.info(`gonogo v${VERSION} (build ${BUILD_TIME})`);

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
