import type { RendezvousPicture } from "@ksp-gonogo/sitrep-sdk";
import { DOCK_LINED_UP_DEG } from "@ksp-gonogo/sitrep-sdk";
import type { EdgeCue } from "@ksp-gonogo/ui-kit";

/** What a camera reports of its picture: the video's size in pixels and its vertical field of view in degrees. */
export type Picture = RendezvousPicture;

/** Degrees either axis may be off the port's line for the cue to read as lined up, the same as the triangles' colouring. */
export const LINED_UP_DEG = DOCK_LINED_UP_DEG;

/** Degrees off the port's line, on either axis, at the rim of the drawn reticle's circle. */
export const DRAWN_FIELD_HALF_DEG = 8;

/** The picture the drawn reticle stands in for when no camera paints one: square, its rim at {@link DRAWN_FIELD_HALF_DEG}. */
export const DRAWN_PICTURE: Picture = {
  frameWidth: 1,
  frameHeight: 1,
  vfovDeg: 2 * DRAWN_FIELD_HALF_DEG,
};
/** How far past the circle's edge the port is, as a share of the circle's radius, when the cue has grown its full reach. */
export const FULL_GROW_OVER = 0.5;

const RAD = Math.PI / 180;

/**
 * The tangent of the angle off the camera's axis at the edge of a square frame
 * the picture is cover-fitted into. The field is vertical, so a picture wider
 * than tall shows the same half-angle on both axes of the square, and a taller
 * one shows less across than up.
 */
export function edgeTangent(picture: Picture): number | null {
  const { frameWidth, frameHeight, vfovDeg } = picture;
  if (
    !(frameWidth > 0) ||
    !(frameHeight > 0) ||
    !(vfovDeg > 0) ||
    vfovDeg >= 180
  ) {
    return null;
  }
  const aspect = frameWidth / frameHeight;
  return Math.tan((vfovDeg * RAD) / 2) * (aspect >= 1 ? 1 : aspect);
}

/**
 * The border cue for a docking port that has left the camera's picture, or
 * null while it is in the picture or nothing is known. The port is at
 * `tan(ax)` across and `tan(ay)` up in the image plane, in units of the focal
 * length, so it is off the picture when that distance passes the edge's
 * tangent. The arc sits at the direction it left by, grows with how far past
 * the edge it is, and is amber unless both angles are within a degree of the
 * port's line, when it is green. This takes the camera to look along the
 * port's axis, which is what `ax` and `ay` are measured from.
 */
export function dockEdgeCue(input: {
  ax: number | undefined;
  ay: number | undefined;
  picture: Picture | null;
}): EdgeCue | null {
  const { ax, ay, picture } = input;
  if (picture === null || ax === undefined || ay === undefined) return null;
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;
  const edge = edgeTangent(picture);
  if (edge === null) return null;
  // Past 90 degrees the port is behind the lens; its tangent is no longer its place in the picture.
  if (Math.abs(ax) >= 90 || Math.abs(ay) >= 90) return null;
  const across = Math.tan(ax * RAD);
  const up = Math.tan(ay * RAD);
  const reach = Math.hypot(across, up);
  if (reach < edge) return null;
  const over = reach / edge - 1;
  const lined = Math.abs(ax) <= LINED_UP_DEG && Math.abs(ay) <= LINED_UP_DEG;
  return {
    angle: Math.atan2(up, across) / RAD,
    tone: lined ? "accent" : "warn",
    grow: Math.min(1, over / FULL_GROW_OVER),
  };
}
