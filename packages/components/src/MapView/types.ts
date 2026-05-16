export type MapBaseLayer = "altimetry" | "biome";

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
}
