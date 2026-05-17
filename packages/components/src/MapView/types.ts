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
}
