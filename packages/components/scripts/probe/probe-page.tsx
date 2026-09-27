/**
 * Widget probe entry: bundled by esbuild for the playwright render harness.
 * Exposes `window.__renderProbe({...})` so the driver can mount the same probe
 * page many times with different fixture and size payloads without reloading
 * or re-bundling.
 */
import type { ProbePayload } from "./payload";
import { renderProbe } from "./probe-entry";

declare global {
  interface Window {
    __renderProbe: (payload: ProbePayload) => Promise<void>;
  }
}

window.__renderProbe = (payload) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Probe: #root element missing");
  return renderProbe(root, payload);
};
