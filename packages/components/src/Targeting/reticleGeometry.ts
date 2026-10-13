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

/** The share of the reference box's shorter side the reticle travels per unit of offset. */
const TRAVEL_FRACTION = 0.4;

/**
 * Pixels the reticle travels per unit of offset, the same on both axes.
 *
 * With a picture behind it the scale is the picture's own: the shorter side
 * of its cover box, so a degree is as far across as it is down and lands where
 * the camera shows it. With none, the reticle keeps a square in the frame.
 */
export function reticleTravelPx(
  frame: Size,
  pictureAspect: number | null,
): number {
  const box = pictureAspect === null ? frame : coverBox(frame, pictureAspect);
  return TRAVEL_FRACTION * Math.min(box.width, box.height);
}
