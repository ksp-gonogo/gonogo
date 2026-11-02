/**
 * Two-body geometry for the rendezvous circles. Everything here takes plain
 * numbers in SI units and degrees as the wire gives them, so a caller
 * unwraps its readings once and the maths stays free of the unit system.
 */

const RAD = Math.PI / 180;

/** The elements of one conic around one body, as `vessel.orbit` and `vessel.target` report them. */
export interface Elements {
  /** Semi-major axis, metres. */
  sma: number;
  ecc: number;
  /** Inclination, degrees. */
  inc: number;
  /** Longitude of the ascending node, degrees; zero where the wire leaves it out. */
  lan: number;
  /** Argument of periapsis, degrees; zero where the wire leaves it out. */
  argPe: number;
  /** Mean anomaly at `epoch`, radians. */
  meanAnomalyAtEpoch: number;
  /** Universal time the mean anomaly is given at, seconds. */
  epoch: number;
  /** The body's gravitational parameter, m³/s². */
  mu: number;
}

export type Vec3 = readonly [number, number, number];

export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};

/** Whether the conic is a closed ellipse that the propagation below can walk. */
export function isClosed(o: Elements): boolean {
  return o.sma > 0 && o.ecc >= 0 && o.ecc < 1 && o.mu > 0;
}

function solveKepler(meanAnomaly: number, ecc: number): number {
  let e = ecc < 0.8 ? meanAnomaly : Math.PI;
  for (let i = 0; i < 40; i++) {
    const step =
      (e - ecc * Math.sin(e) - meanAnomaly) / (1 - ecc * Math.cos(e));
    e -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return e;
}

/** The rotation from the orbit's own plane (periapsis on x) into the body's inertial frame. */
function rotation(o: Elements): readonly [Vec3, Vec3, Vec3] {
  const node = o.lan * RAD;
  const peri = o.argPe * RAD;
  const inc = o.inc * RAD;
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const cw = Math.cos(peri);
  const sw = Math.sin(peri);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  return [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
    [sw * si, cw * si, ci],
  ];
}

const apply = (m: readonly [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [
  dot(m[0], v),
  dot(m[1], v),
  dot(m[2], v),
];

/** Where the craft is and how fast it moves at `ut`, in the body's inertial frame. Null for an open conic. */
export function stateAt(o: Elements, ut: number): { r: Vec3; v: Vec3 } | null {
  if (!isClosed(o)) return null;
  const n = Math.sqrt(o.mu / o.sma ** 3);
  const e = solveKepler(o.meanAnomalyAtEpoch + n * (ut - o.epoch), o.ecc);
  const cE = Math.cos(e);
  const sE = Math.sin(e);
  const b = o.sma * Math.sqrt(1 - o.ecc ** 2);
  const radius = o.sma * (1 - o.ecc * cE);
  const speed = Math.sqrt(o.mu * o.sma) / radius;
  const m = rotation(o);
  return {
    r: apply(m, [o.sma * (cE - o.ecc), b * sE, 0]),
    v: apply(m, [-speed * sE, speed * Math.sqrt(1 - o.ecc ** 2) * cE, 0]),
  };
}

/** A closed orbit as `count + 1` points round it, in the body's inertial frame. */
export function orbitPoints(o: Elements, count = 180): Vec3[] {
  if (!isClosed(o)) return [];
  const m = rotation(o);
  const b = o.sma * Math.sqrt(1 - o.ecc ** 2);
  const points: Vec3[] = [];
  for (let k = 0; k <= count; k++) {
    const e = (2 * Math.PI * k) / count;
    points.push(apply(m, [o.sma * (Math.cos(e) - o.ecc), b * Math.sin(e), 0]));
  }
  return points;
}

/** The orbit's period, seconds; null for an open conic. */
export function period(o: Elements): number | null {
  return isClosed(o) ? 2 * Math.PI * Math.sqrt(o.sma ** 3 / o.mu) : null;
}

/**
 * A craft's place in the target's local frame: `x` outward along the target's
 * radius, `y` along its track (forward), `z` along its orbit normal. Null
 * where either craft is on an open conic.
 */
export function relativeInTargetFrame(
  chaser: Elements,
  target: Elements,
  ut: number,
): Vec3 | null {
  const c = stateAt(chaser, ut);
  const t = stateAt(target, ut);
  if (c === null || t === null) return null;
  const radial = unit(t.r);
  const normal = unit(cross(t.r, t.v));
  const along = cross(normal, radial);
  const d = sub(c.r, t.r);
  return [dot(d, radial), dot(d, along), dot(d, normal)];
}

/** The angle at the body from the chaser to the target, degrees, positive when the target leads. Null on an open conic. */
export function phaseAngle(
  chaser: Elements,
  target: Elements,
  ut: number,
): number | null {
  const c = stateAt(chaser, ut);
  const t = stateAt(target, ut);
  if (c === null || t === null) return null;
  const normal = unit(cross(c.r, c.v));
  const angle = Math.atan2(dot(cross(c.r, t.r), normal), dot(c.r, t.r));
  return angle / RAD;
}

/** The angle between the two orbital planes, degrees. Null on an open conic. */
export function relativeInclination(
  chaser: Elements,
  target: Elements,
  ut: number,
): number | null {
  const c = stateAt(chaser, ut);
  const t = stateAt(target, ut);
  if (c === null || t === null) return null;
  const a = unit(cross(c.r, c.v));
  const b = unit(cross(t.r, t.v));
  return Math.atan2(norm(cross(a, b)), dot(a, b)) / RAD;
}

/**
 * The chaser's track relative to the target over `[ut, ut + span]`, each
 * point in the target's local frame as of its own time, so a straight
 * co-orbiting approach stays a line. Null on an open conic.
 */
export function relativeTrack(
  chaser: Elements,
  target: Elements,
  ut: number,
  span: number,
  count = 60,
): Vec3[] | null {
  const track: Vec3[] = [];
  for (let k = 0; k <= count; k++) {
    const p = relativeInTargetFrame(chaser, target, ut + (span * k) / count);
    if (p === null) return null;
    track.push(p);
  }
  return track;
}

/**
 * Projects inertial points onto the plane of `target`'s orbit, as `[x, y]`
 * with x toward the ascending node and the plane's normal out of the screen.
 * The plane is the one frame both craft's orbits can be drawn in at once.
 */
export function planeBasis(target: Elements): { e1: Vec3; e2: Vec3 } {
  const m = rotation({ ...target, argPe: 0 });
  const e1 = m[0].map((_, i) => m[i][0]) as unknown as Vec3;
  const e2 = m[0].map((_, i) => m[i][1]) as unknown as Vec3;
  return { e1: unit(e1), e2: unit(e2) };
}
