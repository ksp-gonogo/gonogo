export type MapBaseLayer = "altimetry" | "biome";

/**
 * Per-scan-type fog-layer visibility. Operators tick which scan types
 * contribute to the fog reveal — useful when running a single-type
 * survey (e.g. "only show AltimetryHiRes coverage so I can see how much
 * detail-mapping is left"). When undefined for any key, that layer
 * defaults to on.
 */
export interface FogLayerToggles {
  altimetryLoRes?: boolean;
  altimetryHiRes?: boolean;
  biome?: boolean;
  resourceLoRes?: boolean;
  resourceHiRes?: boolean;
}

export interface MapViewConfig {
  /** Number of trajectory history points to keep. Default: 2000. */
  trajectoryLength?: number;
  /** Data keys selected for display in the telemetry panel. */
  telemetryKeys?: string[];
  /**
   * Render the predicted ground track from `o.orbitPatches`. Default: true.
   * When false, prediction is never computed — saves the work entirely.
   */
  showPrediction?: boolean;
  /**
   * Base map mode. `altimetry` shows the body's stock surface texture
   * gated by SCANsat AltimetryHiRes coverage; `biome` paints per-tile
   * biome colours from `scan.biomeGrid`. Defaults to altimetry — the
   * familiar view.
   */
  baseLayer?: MapBaseLayer;
  /**
   * Overlay a normalised elevation gradient from `scan.heightGrid` on
   * top of whichever base layer is selected. ~130 KB one-shot fetch on
   * body change — opt-in to keep idle bandwidth low.
   */
  showHeightShading?: boolean;
  /**
   * Render markers for known anomalies on the current body. Pulls
   * `scan.anomalies[body]` — undiscovered anomalies are not rendered
   * (operator can't see what they haven't found), discovered with name
   * shown brighter than discovered-without-name.
   */
  showAnomalies?: boolean;
  /**
   * Per-scan-type fog-layer visibility. Each toggle controls whether
   * that type's coverage contributes to the fog reveal. Unset = on.
   *
   * The display canvas composites enabled layers with HiRes-over-LoRes
   * precedence within each channel (AltHiRes-covered tiles reveal
   * brighter than AltLoRes-only tiles, same for ResourceHiRes vs LoRes).
   */
  fogLayers?: FogLayerToggles;
  /**
   * Body to map. When set, MapView renders this body's scan layers
   * (texture / biome / height / fog / anomalies / coverage / footprints)
   * regardless of where the active vessel is — so you can check the Mun's
   * coverage while orbiting Kerbin. Unset = follow the active vessel's
   * `v.body` (the default). Every `scan.*` key is parametric by body, so
   * this needs no data-source or fork change.
   *
   * When the override differs from the active vessel's body, the vessel
   * marker, trajectory trail and prediction are suppressed — plotting a
   * Kerbin craft onto the Mun map would be misleading.
   */
  bodyOverride?: string;
  /**
   * Overlay every `scan.scanningVessels` entry's ground-track footprint
   * for the mapped body (using the SCANsat-supplied `groundTrackWidthDeg`
   * / `groundTrackLonHalfDeg` extents + `trackColor` tint). Lets you watch
   * an unloaded mapping sat fill in coverage. Default: off.
   */
  showFootprints?: boolean;
  /**
   * Show a compact per-scan-type coverage readout (from
   * `scan.coverage[body,type]`) plus which scanners are currently
   * in-range / best-range, below the map. Default: off.
   */
  showCoverage?: boolean;
  /**
   * Show a side list of discovered anomalies (`scan.anomalies[body]`,
   * `known` only) sorted by great-circle distance from the active
   * vessel, each with bearing + distance. Distance/bearing are only
   * meaningful when the mapped body is the vessel's body — when a
   * `bodyOverride` diverges, the panel lists names without distances.
   * Default: off.
   */
  showAnomalyPanel?: boolean;
}
