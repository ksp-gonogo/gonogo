// SCANsat Uplink client for gonogo.
//
// Co-located with the GonogoScansatUplink C# mod (mod/GonogoScansatUplink):
// one directory holds the mod and the client TS it ships (Uplink architecture
// §1). Importing this package's entry point side-effects the widget
// registration into @ksp-gonogo/core's global component registry:
//
//   - `Scanning` component → registerComponent({ id: "scanning", ... }) so it
//     is placeable from the dashboard widget picker.
//   - `ScansatScienceAugment` → registerAugment({ id: "scansat-science", ... })
//     so it fills @ksp-gonogo/components's ScienceOfficer widget's
//     `science-officer.badges` slot (design brief:
//     local_docs/telemetry-mod/scansat-sci-brief-augment.md).
//   - `AnomalyOverlay` → registerAugment({ id: "scansat-anomaly-overlay", ... })
//     so it fills @ksp-gonogo/components's MapView widget's
//     `map-view.overlay` slot with the on-map anomaly markers + bearing/
//     distance panel (P4c-b: scansat.anomalies.<body> sign-off, see
//     docs/superpowers/plans/2026-07-11-p4cb-deletion-plan.md §1).
//
// To wire it into the app: `import "@ksp-gonogo/scansat";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// The rest of the scan OVERLAY on core MapView (biome/fog/footprint layers)
// stays in @ksp-gonogo/components for now — it is bidirectionally coupled to
// the core map and is separately-deferred debt (see the P4c-b plan's SCOPE
// GUARD: only the anomaly overlay moved out, not the broader fog/coverage
// scan overlay). Until that extracts too, the Minimap here reuses those
// hooks via @ksp-gonogo/components.

export { AnomalyOverlay } from "./AnomalyOverlay";
export type {
  ScanningConfig,
  ScanningSlotContext,
} from "./Scanning";
export { ScanningComponent } from "./Scanning";
export type { MinimapProps } from "./Scanning/Minimap";
export { Minimap, MinimapForActiveVessel } from "./Scanning/Minimap";
export { parseScanScience } from "./ScienceAugment";

// Side-effect registration. Kept as bare imports so the built dist/index.js
// retains them and bundlers won't tree-shake the registerComponent()/
// registerAugment() calls away.
import "./Scanning";
import "./ScienceAugment";
import "./AnomalyOverlay";
