export interface Size {
  width: number;
  height: number;
}

/**
 * The box a picture of `aspect` (width over height) fills when painted into
 * `frame` with `object-fit: cover`: at least the frame on both axes, centred on
 * it, and cropped by it on the longer one.
 */
export function coverBox(frame: Size, aspect: number): Size {
  if (frame.width / frame.height > aspect) {
    return { width: frame.width, height: frame.width / aspect };
  }
  return { width: frame.height * aspect, height: frame.height };
}

/** The picture a camera paints behind the reticle: its shape and its vertical field of view. */
export interface Picture {
  aspect: number;
  verticalFovDeg: number;
}

/** The share of the reference box's shorter side the reticle travels per unit of offset. */
const TRAVEL_FRACTION = 0.4;

const RAD_PER_DEG = Math.PI / 180;

/**
 * Pixels from the picture's centre to a direction of a given tangent off its axis,
 * for a camera of `verticalFovDeg` painted into `frame` with
 * `object-fit: cover`: the cover box's height over twice the tangent of half
 * the field, times the tangent. The field is vertical and fixed while the
 * picture's shape changes, so the scale follows the cover box's height.
 */
export function pictureFocalPx(frame: Size, picture: Picture): number {
  const box = coverBox(frame, picture.aspect);
  return box.height / 2 / Math.tan((picture.verticalFovDeg * RAD_PER_DEG) / 2);
}

/**
 * Pixels the reticle travels per unit of offset, the same on both axes.
 *
 * With a picture, a unit is the
 * pixels from the centre to `maxDeg` off boresight in that picture, so a
 * target at an angle lands where the camera draws it. With none the reticle
 * keeps a square in the frame.
 */
export function reticleTravelPx(
  frame: Size,
  picture: Picture | null,
  maxDeg: number,
): number {
  if (picture !== null && picture.verticalFovDeg !== null) {
    return (
      pictureFocalPx(frame, {
        ...picture,
        verticalFovDeg: picture.verticalFovDeg,
      }) * Math.tan(maxDeg * RAD_PER_DEG)
    );
  }
  const box = picture === null ? frame : coverBox(frame, picture.aspect);
  return TRAVEL_FRACTION * Math.min(box.width, box.height);
}

/**
 * The reticle's offset on one axis in units of {@link reticleTravelPx}, for a
 * line of sight `deg` off boresight on that axis. Against a picture it is the pinhole projection, `tan(deg) / tan(maxDeg)`, and goes past
 * 1 where the picture shows the target beyond `maxDeg`. With none it is linear
 * in the angle and held within `maxDeg`.
 */
export function reticleOffset(
  deg: number,
  maxDeg: number,
  picture: Picture | null,
): number {
  if (picture !== null) {
    return Math.tan(deg * RAD_PER_DEG) / Math.tan(maxDeg * RAD_PER_DEG);
  }
  return Math.max(-maxDeg, Math.min(maxDeg, deg)) / maxDeg;
}
