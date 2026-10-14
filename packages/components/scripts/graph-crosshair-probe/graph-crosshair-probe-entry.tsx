/**
 * Mounts `Graph` with the crosshair on (or off, for the before shots) over a
 * fixed ascent: altitude and speed on two axes, a hole in the speed trace, a
 * modelled tail on the altitude trace, and an altitude ceiling.
 */
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  type ChartSeries,
  Graph,
  type GraphThreshold,
} from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

interface Payload {
  crosshair: boolean;
  pxW: number;
  pxH: number;
}

const T = Array.from({ length: 61 }, (_, i) => i * 5);
const SPEED_HOLE_FROM = 22;
const SPEED_HOLE_TO = 34;
const speedT = T.filter((_, i) => i < SPEED_HOLE_FROM || i >= SPEED_HOLE_TO);

const series: ChartSeries[] = [
  {
    id: "alt",
    label: "Altitude",
    axis: "primary",
    color: "#4fc3f7",
    format: (y) => `${(y / 1000).toFixed(2)} km`,
    data: {
      x: T,
      y: T.map((t) => 1.1 * t * t),
      reckoned: [{ from: 54, to: 60, basis: "linear-dead-reckoning" }],
    },
  },
  {
    id: "spd",
    label: "Surface speed",
    axis: "secondary",
    color: "#ffb74d",
    format: (y) => `${y.toFixed(0)} m/s`,
    data: {
      x: speedT,
      y: speedT.map((t) => 4.5 * t + 0.0107 * t * t),
      breaks: [SPEED_HOLE_FROM],
    },
  },
];

const thresholds: GraphThreshold[] = [
  {
    id: "ceiling",
    kind: "limit",
    bad: "above",
    value: value("m", 60_000),
    label: "Altitude ceiling",
  },
];

let activeRoot: Root | null = null;

async function render(payload: Payload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("graph-crosshair probe: #root missing");
  activeRoot?.unmount();
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(Graph, {
      chrome: "bare",
      series,
      thresholds,
      xDomain: [0, 300],
      xTickFormat: (v: number) => `T+${v}s`,
      crosshair: payload.crosshair,
      "aria-label": "Ascent",
      height: payload.pxH,
    }),
  );
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

declare global {
  interface Window {
    __renderGraphCrosshair: (payload: Payload) => Promise<void>;
  }
}
window.__renderGraphCrosshair = render;
