import {
  ErrorBoundary,
  logger,
  registerStockBodies,
  setAppVersion,
} from "@gonogo/core";
import { ModalProvider } from "@gonogo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@gonogo/components"; // triggers all component self-registration
import "./dataSources"; // triggers all data source self-registration
import "./goNoGo/GoNoGoComponent"; // app-level component — registers on import
import "./streamSources"; // triggers all stream source self-registration
import App from "./App";
import { BUILD_TIME, VERSION } from "./version";

setAppVersion(VERSION, BUILD_TIME);
logger.info(`gonogo v${VERSION} (build ${BUILD_TIME})`);

// Pass the Vite base URL so texture paths resolve correctly under sub-path
// deployments (e.g. /gonogo/bodies/ on GitHub Pages).
registerStockBodies(`${import.meta.env.BASE_URL}bodies`);

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) throw new Error("Could not find root node.");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <App />
        </ModalProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
