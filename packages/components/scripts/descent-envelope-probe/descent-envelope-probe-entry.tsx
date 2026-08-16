/**
 * Standalone probe for DescentEnvelope's drag-to-weight PROTOTYPE
 * (`dragToWeight` / `dragDisplay`). DescentEnvelope is a plain
 * presentational SVG component (no data hooks, no styled-components
 * theme) so it mounts directly here with explicit props, rather than
 * through the full LandingStatus widget + telemetry fixture pipeline
 * the shared `probe/probe-entry.tsx` drives. No wire field backs
 * `dragToWeight` yet, this exists purely so the two visual treatments
 * can be compared before any mod/contract work happens.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DescentEnvelope,
  type DescentEnvelopeProps,
} from "../../src/LandingStatus/DescentEnvelope";

interface DescentEnvelopeProbePayload {
  props: DescentEnvelopeProps;
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

async function renderDescentEnvelope(
  payload: DescentEnvelopeProbePayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("DescentEnvelope probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.background = "var(--color-surface-app)";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(createElement(DescentEnvelope, payload.props));

  // Two raf ticks so layout settles before the screenshot; the widget
  // itself has no animation/transition to wait out.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

declare global {
  interface Window {
    __renderDescentEnvelope: (
      payload: DescentEnvelopeProbePayload,
    ) => Promise<void>;
  }
}

window.__renderDescentEnvelope = renderDescentEnvelope;

// Re-export so fixture authors' types stay in sync with the component.
export type { DescentEnvelopeProps };
