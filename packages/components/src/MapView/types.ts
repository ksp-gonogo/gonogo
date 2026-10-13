export interface MapViewConfig {
  /** Number of trajectory history points to keep. Default: 2000. */
  trajectoryLength?: number;
  /** Render the predicted ground track. Default true; false skips computing it. */
  showPrediction?: boolean;
  /**
   * Body to map, regardless of where the active vessel is. Unset follows the
   * vessel. When it differs from the vessel's body, the marker, trail and
   * prediction are suppressed.
   */
  bodyOverride?: string;
  /** Renders the shared POI layer. Default true: vanilla POIs are reference points, not an opt-in feature. */
  showPois?: boolean;
  /**
   * Per-augment settings, namespaced by augment id: the read-back half of
   * `registerAugment({ settings: [...] })`, written by `AugmentSettingsPanel`.
   */
  augmentSettings?: Record<string, Record<string, unknown>>;
}
