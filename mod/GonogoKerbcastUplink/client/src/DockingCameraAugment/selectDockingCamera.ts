import type { KerbcastCameraEntry } from "@ksp-gonogo/sitrep-sdk";

/**
 * Picks the camera that should back DistanceToTarget's docking HUD, from the
 * `kerbcast.cameras` inventory the Uplink publishes.
 *
 * `isDockingCamera` is `bool?` on the wire (`DockingCameraFacts.cs`), and the
 * three states are genuinely distinct — the mod's own doc is explicit that
 * `false` means "read the part, it has no docking module", while absent means
 * "couldn't read the part at all". Collapsing null to false would demote a
 * camera we simply failed to introspect to the same rank as one we positively
 * know isn't a docking camera. So cameras rank:
 *
 *   1. `true`      — known docking camera, the whole point of the augment
 *   2. `null`/absent — unknown; might be one, ranks above a known-negative
 *   3. `false`     — known not a docking camera; last resort, never excluded
 *
 * Rank 3 is still eligible because the built-in `HudCamera` this augment
 * replaces fell back to `cameras[0]` unconditionally — it had no docking facts
 * to reason with. Dropping to "no video" where the old widget showed *a* feed
 * would be a regression, so a known-negative camera is used rather than
 * nothing. `isDockingCamera` sharpens the CHOICE; it doesn't narrow the pool.
 *
 * An explicit `override` (the widget's saved `cameraFlightId`) always wins when
 * that camera is still present, so a pinned camera keeps working. A stale
 * override — pinned camera no longer in the inventory — falls through to the
 * ranking rather than blanking the HUD.
 *
 * Returns the kerbcast `flightId` to stream, or `null` when there is nothing to
 * show. `cameraId` IS the kerbcast flightId: `KerbcastCameraEntryBuilder.Build`
 * maps `["cameraId"] = view.FlightId`. That identity is what lets this augment
 * select on Uplink CONTROL facts and stream over kerbcast's own WebRTC media
 * path without a second identifier space.
 */
export function selectDockingCamera(
  cameras: readonly KerbcastCameraEntry[] | undefined,
  override?: number | null,
): number | null {
  if (!cameras || cameras.length === 0) return null;

  const usable = cameras.filter(
    (c): c is KerbcastCameraEntry & { cameraId: number } =>
      typeof c.cameraId === "number",
  );
  if (usable.length === 0) return null;

  if (override != null && usable.some((c) => c.cameraId === override)) {
    return override;
  }

  // Lower rank sorts first. Deliberately three-valued — see the doc above.
  const rank = (c: KerbcastCameraEntry): number => {
    if (c.isDockingCamera === true) return 0;
    if (c.isDockingCamera == null) return 1;
    return 2;
  };

  let best = usable[0];
  for (const c of usable) {
    if (rank(c) < rank(best)) best = c;
  }
  return best.cameraId;
}
