/**
 * Standalone probe for the three states a trace can be in: observed (live or
 * replayed), gone, and reckoned.
 *
 * Mounts `LineChart` directly with explicit props rather than going through a
 * widget + telemetry fixture, for two reasons. The chart is presentational
 * (arrays in, SVG out, no data hooks), and the reckoned state has no producer
 * on the stream, so no telemetry fixture can drive it. Feeding the chart by
 * hand is the honest way to show a presentation that is waiting for one.
 */
import { LineChart, type LineChartProps } from "@ksp-gonogo/ui";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

interface ChartProvenanceProbePayload {
  props: LineChartProps;
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

async function renderChartProvenance(
  payload: ChartProvenanceProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("chart-provenance probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(createElement(LineChart, payload.props));

  // Two raf ticks so layout settles before the screenshot. The chart has no
  // animation of its own to wait out.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

declare global {
  interface Window {
    __renderChartProvenance: (
      payload: ChartProvenanceProbePayload,
    ) => Promise<void>;
  }
}

window.__renderChartProvenance = renderChartProvenance;

// Re-export so fixture authors' types stay in sync with the component.
export type { LineChartProps };
