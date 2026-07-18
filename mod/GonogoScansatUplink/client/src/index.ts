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
//   - `AnomalyOverlay/index.ts` → registerMapPoiProvider({ id:
//     "scansat:anomalies", requires: "scansat", ... }) so discovered
//     anomalies render through @ksp-gonogo/components's MapView's shared
//     `MapPoiLayer`, gaining the uniform "Set as Target" action (MapView
//     overlay-host foundation plan T-POI-8, replacing the old
//     `map-view.overlay` augment + its bespoke bearing/distance panel).
//   - `FootprintOverlay` → registerAugment({ id: "scansat-footprint-overlay",
//     ... }) so it fills the same `map-view.overlay` slot with scanning-
//     vessel ground-track footprints (MapView overlay-host foundation plan
//     T8a), replacing the old MapView-internal `drawScanningFootprints`.
//   - `CoveragePanel` → registerAugment({ id: "scansat-coverage-panel", ... })
//     so it fills the `map-view.sections` slot with the per-scan-type
//     coverage readout (MapView overlay-host foundation plan T8b), replacing
//     the old MapView-internal `CoveragePanelView`/`CoverageRow`.
//   - `TerrainBase/AltimetryBase` + `TerrainBase/BiomeBase` →
//     registerAugment({ id: "scansat:altimetry" | "scansat:biome",
//     augments: "map-view.base", ... }) — two mutually-exclusive providers
//     for the `map-view.base` REPLACE slot (MapView overlay-host foundation
//     plan T8c), each painting its own standalone colormap surface
//     (altimetry or biome) modulated per-tile by the T4 coverage paint-gate,
//     replacing the old MapView-internal `useBiomeCanvas`/`useHeightCanvas`.
//   - `FogReveal/useScanSatFogSync` → registerFogRevealSource(...) once per
//     scan type ("scansat:AltimetryLoRes" etc., MapView overlay-host
//     foundation plan T7) so MapView's coverage paint-gate knows this
//     Uplink contributes fog reveal, even before anything calls
//     useScanSatFogSync itself.
//
// To wire it into the app: `import "@ksp-gonogo/scansat";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// The scan schema/decode/sync logic (`schema.ts`, `FogReveal/*`) is this
// Uplink's own canonical copy (T7). `packages/core`/`packages/data` still
// carry a duplicate for `packages/components`'s MapView, which hasn't
// migrated off it yet — see T9 in
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md for
// the deletion of that duplicate once MapView's augment migration lands.
// The Minimap here (`Scanning/Minimap.tsx`) has its own mod-local coverage
// gate (`FogReveal/useScanCoverageGate.ts`) and paints through T8c's
// `TerrainBase/paintTile.ts`, same as BiomeBase — it no longer borrows
// MapView's canvas hooks via @ksp-gonogo/components at all (T9-Minimap).

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
import "./FootprintOverlay";
import "./CoveragePanel";
import "./TerrainBase/AltimetryBase";
import "./TerrainBase/BiomeBase";
import "./FogReveal/useScanSatFogSync";
