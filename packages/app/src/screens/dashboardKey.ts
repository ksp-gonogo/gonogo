import type { Screen } from "@ksp-gonogo/core";

/**
 * Per-scene working layouts: each of the four "real" KSP scenes gets its own
 * auto-persisted dashboard slot, so edits made in one scene survive switching
 * to another and back. Transient and unknown scenes use the shared base key.
 */
const SCENE_SCOPED_KEYS = new Set([
  "SpaceCenter",
  "Editor",
  "Flight",
  "TrackingStation",
]);

/** Each screen keeps its own layouts: a pilot's dashboard is not the main screen's. */
export function dashboardKeyForScene(
  screen: Screen,
  scene: string | undefined,
): string {
  const base = `gonogo:dashboard:${screen}`;
  return scene && SCENE_SCOPED_KEYS.has(scene) ? `${base}:${scene}` : base;
}
