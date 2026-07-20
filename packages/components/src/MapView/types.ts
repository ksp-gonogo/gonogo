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
   * Body to map. When set, MapView renders this body's base surface (and
   * whatever `map-view.base`/`map-view.overlay`/`map-view.sections`
   * augments have registered) regardless of where the active vessel is —
   * so you can inspect another body while orbiting elsewhere. Unset =
   * follow the active vessel's `v.body` (the default).
   *
   * When the override differs from the active vessel's body, the vessel
   * marker, trajectory trail and prediction are suppressed — plotting a
   * Kerbin craft onto the Mun map would be misleading.
   */
  bodyOverride?: string;
  /**
   * Renders the shared POI layer (`map-view.overlay`-adjacent, T-POI-7).
   * Default true — vanilla POIs (KSC, contract targets) are always-relevant
   * reference points, not an opt-in SCANsat-shaped feature.
   */
  showPois?: boolean;
  /**
   * Per-augment settings (spec §4.7), namespaced by augment id — the
   * read-back half of `registerAugment({ settings: [...] })`. Populated by
   * `AugmentSettingsPanel` in the config UI, merged from
   * `getAugmentSettings("map-view.overlay"|"map-view.sections"|"map-view.base")`
   * and `getFogRevealSourceSettings()`. Read back into `MapSectionsContext`/
   * `MapBaseLayerContext`'s `augmentSettings` field at render time.
   */
  augmentSettings?: Record<string, Record<string, unknown>>;
}
