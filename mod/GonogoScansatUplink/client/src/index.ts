// SCANsat Uplink client for gonogo.
//
// Co-located with the GonogoScansatUplink C# mod (mod/GonogoScansatUplink):
// one directory holds the mod and the client TS it ships (Uplink architecture
// §1). Importing this package's entry point side-effects the widget
// registration into @ksp-gonogo/core's global component registry:
//
//   - `Scanning` component → registerComponent({ id: "scanning", ... }) so it
//     is placeable from the dashboard widget picker.
//
// To wire it into the app: `import "@ksp-gonogo/scansat";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// The scan OVERLAY on the core MapView (biome/fog/footprint layers) stays in
// @ksp-gonogo/components for now — it is bidirectionally coupled to the core map
// and only cleanly extracts once the `map-view.overlay` augment slot exists
// (arch §4.8). Until then the Minimap here reuses those hooks via
// @ksp-gonogo/components.

export type {
  ScanningConfig,
  ScanningSlotContext,
} from "./Scanning";
export { ScanningComponent } from "./Scanning";
export type { MinimapProps } from "./Scanning/Minimap";
export { Minimap, MinimapForActiveVessel } from "./Scanning/Minimap";

// Side-effect registration. Kept as a bare import so the built dist/index.js
// retains it and bundlers won't tree-shake the registerComponent() call away.
import "./Scanning";
