/**
 * Widget probe entry: bundled by esbuild for the playwright render harness.
 * Exposes `window.__renderProbe({...})` so the driver can mount the same probe
 * page many times with different fixture and size payloads without reloading
 * or re-bundling.
 */

import { getComponent } from "@ksp-gonogo/core";
import { dispatchAction } from "@ksp-gonogo/sitrep-sdk";
import {
  auditMinFit,
  type MinFitFinding,
} from "../../../uplink-tools/src/render/minFit";
import type { ProbePayload } from "./payload";
import { renderProbe } from "./probe-entry";
import "./plantedTinyMisfitWidget";
import "./plantedEmptyMap";
import "./plantedLockedAugment";

declare global {
  interface Window {
    __renderProbe: (payload: ProbePayload) => Promise<void>;
    /** What cannot be read in the tile, when the kit's tiny form is what it shows; null when it is not. */
    __auditTinyFit: () => MinFitFinding[] | null;
    /** The actions a registered widget declares, each with the input kind that drives it. */
    __probeActions: (
      widgetId: string,
    ) => { id: string; label: string; kind: "button" | "analog" }[];
    /** Fires one declared action on the mounted widget, a press then a release for a button. */
    __dispatchProbeAction: (id: string, kind: "button" | "analog") => void;
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

window.__probeActions = (widgetId) =>
  (getComponent(widgetId)?.actions ?? []).map((a) => ({
    id: a.id,
    label: a.label,
    kind: a.accepts.includes("button") ? "button" : "analog",
  }));

window.__dispatchProbeAction = (id, kind) => {
  const pressed = kind === "button" ? true : 1;
  const released = kind === "button" ? false : 0;
  dispatchAction("probe", id, { kind, value: pressed });
  dispatchAction("probe", id, { kind, value: released });
};
