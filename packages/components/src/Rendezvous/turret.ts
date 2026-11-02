/**
 * The turning of the circles. Every circle travels on an arc about one pivot
 * below the view, all in the same sense, tilting a little as it goes and ending
 * upright, like objectives on a microscope's nosepiece turning one into place.
 */

export interface Point {
  x: number;
  y: number;
}

/** A circle's place at one instant: its centre, its tilt in radians and its scale. */
export interface Pose extends Point {
  tilt: number;
  scale: number;
}

/** Smoothstep, held at 0 below and 1 above. */
export function ease(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Where the pivot sits: below the view's middle, so every arc between the three places turns the same way. */
export function pivotFor(box: { w: number; h: number }): Point {
  return { x: box.w / 2, y: box.h * 1.02 };
}

/** The tilt carried at the start of an arc, as a share of the angle it sweeps. */
export const TILT_SHARE = 0.35;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function unwrap(from: number, to: number): number {
  let a = to;
  while (a - from > Math.PI) a -= 2 * Math.PI;
  while (a - from < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * A point `t` of the way from `from` to `to` on the arc about `pivot`. The tilt
 * is a share of the angle `sweep`, the turn of the whole plane, and falls to
 * zero on arrival, so every circle on the plane leans together.
 */
export function arcPose(
  pivot: Point,
  from: Point,
  to: Point,
  t: number,
  scaleFrom = 1,
  scaleTo = 1,
  sweep?: number,
): Pose {
  const a0 = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const a1 = unwrap(a0, Math.atan2(to.y - pivot.y, to.x - pivot.x));
  const r0 = Math.hypot(from.x - pivot.x, from.y - pivot.y);
  const r1 = Math.hypot(to.x - pivot.x, to.y - pivot.y);
  const a = lerp(a0, a1, t);
  const r = lerp(r0, r1, t);
  return {
    x: pivot.x + r * Math.cos(a),
    y: pivot.y + r * Math.sin(a),
    tilt: TILT_SHARE * (sweep === undefined ? a - a1 : -(1 - t) * sweep),
    scale: lerp(scaleFrom, scaleTo, t),
  };
}

/** The three places a circle can be: large, small and out of frame to the left or entering from the right. */
export interface Places {
  large: Point;
  small: Point;
  out: Point;
  incoming: Point;
  /** The small circle's scale against the large one. */
  smallScale: number;
}

/**
 * Where each of the three moving circles is at progress `u` of one step in, `0`
 * before and `1` after. All of them ride one plane: one progress, one easing
 * and one lean, so none starts or stops before another.
 */
export function stepPoses(
  pivot: Point,
  places: Places,
  u: number,
): { leaving: Pose; old: Pose; arriving: Pose } {
  const e = ease(u);
  const sweep =
    unwrap(
      Math.atan2(places.large.y - pivot.y, places.large.x - pivot.x),
      Math.atan2(places.small.y - pivot.y, places.small.x - pivot.x),
    ) - Math.atan2(places.large.y - pivot.y, places.large.x - pivot.x);
  return {
    leaving: arcPose(
      pivot,
      places.large,
      places.small,
      e,
      1,
      places.smallScale,
      sweep,
    ),
    old: arcPose(
      pivot,
      places.small,
      places.out,
      e,
      places.smallScale,
      places.smallScale,
      sweep,
    ),
    arriving: arcPose(pivot, places.incoming, places.large, e, 1, 1, sweep),
  };
}
