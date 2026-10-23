/**
 * Mounts the Graph widget's settings form with two series rows, one of them a
 * band, so every control a phone operator reaches while picking a series is on
 * screen. Exposes `window.__renderGraphConfig(payload)`.
 */

import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { GraphConfigComponent } from "../../src/Graph/GraphConfigForm";

let activeRoot: Root | null = null;

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderGraphConfig(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("graph-config probe: #root element missing");
  activeRoot?.unmount();
  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(
      ThemeProvider,
      { theme: defaultDarkTheme },
      createElement(GraphConfigComponent, {
        config: {
          windowSec: 300,
          series: [
            { id: "a", key: "", type: "line", axis: "auto" },
            { id: "b", key: "", type: "band", axis: "primary" },
          ],
        },
        onSave: () => {},
      }),
    ),
  );
  await settle(150);
}

(
  window as unknown as { __renderGraphConfig: () => Promise<void> }
).__renderGraphConfig = renderGraphConfig;
