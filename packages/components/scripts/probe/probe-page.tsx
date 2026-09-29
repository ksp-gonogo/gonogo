/**
 * Widget probe entry: bundled by esbuild for the playwright render harness.
 * Exposes `window.__renderProbe({...})` so the driver can mount the same probe
 * page many times with different fixture and size payloads without reloading
 * or re-bundling.
 */
import {
  auditMinFit,
  type MinFitFinding,
} from "../../../uplink-tools/src/render/minFit";
import type { ProbePayload } from "./payload";
import { renderProbe } from "./probe-entry";
import "./plantedTinyMisfitWidget";

declare global {
  interface Window {
    __renderProbe: (payload: ProbePayload) => Promise<void>;
    /** What cannot be read in the tile, when the kit's tiny form is what it shows; null when it is not. */
    __auditTinyFit: () => MinFitFinding[] | null;
  }
}

function probeRoot(): HTMLElement {
  const root = document.getElementById("root");
  if (!root) throw new Error("Probe: #root element missing");
  return root;
}

window.__renderProbe = (payload) => renderProbe(probeRoot(), payload);

window.__auditTinyFit = () => {
  const root = probeRoot();
  if (!root.querySelector("[data-tiny-essential]")) return null;
  return auditMinFit(root);
};
