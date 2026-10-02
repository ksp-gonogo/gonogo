/**
 * The patch chain the wire carries (`vessel.orbit.patches`, and each
 * `vessel.maneuver.nodes[].patches`), propagated through the one Kepler solve
 * and laid over a turning body's surface. The ground track and the impact
 * point are both this walk; they differ only in where they stop.
 */
import type { OrbitPatch } from "../__generated__/contract";
import { type Value, value } from "../unit-system/value";
import {
  rotatePerifocalToInertial,
  solveEccentricAnomaly,
  trueAnomalyFromEccentric,
} from "./kepler";

/** The elements of a patch a propagation reads. */
export type PatchConic = Pick<
  OrbitPatch,
  | "sma"
  | "ecc"
  | "inc"
  | "lan"
  | "argPe"
  | "meanAnomalyAtEpoch"
  | "epoch"
  | "period"
>;

/** A patch's conic with the window it holds for and the body it is around. */
export type PatchSpan = PatchConic &
  Pick<OrbitPatch, "startUt" | "endUt" | "referenceBody">;

export interface InertialState {
  /** Body-centred inertial XYZ in metres. +z is the body's rotation axis. */
  x: number;
  y: number;
  z: number;
  /** Distance from the body centre, metres. */
  radius: number;
}

export interface GeoState {
  /** Latitude, degrees. KSP bodies have no axial tilt, so inertial and body-fixed agree. */
  lat: number;
  /** Altitude above the mean radius, metres; negative below it. */
  alt: number;
  /** Inertial longitude, degrees. */
  lonInertial: number;
}

export interface PredictionRef {
  /** Current universal time, seconds. */
  ut: number;
  /** Vessel latitude at `ut`, degrees. */
  lat: number;
  /** Vessel body-fixed longitude at `ut`, degrees. */
  lon: number;
}

export interface TrackSample {
  ut: number;
  lat: number;
  lon: number;
  alt: number;
  /** Index into the walked chain of the patch the sample was drawn from. */
  patchIndex: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wrap a degree value to (-180, 180], preferring +180 for continuity. */
function wrap180(deg: number): number {
  let x = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (x <= -180) x = 180;
  return x;
}

/** The window a patch holds for, as UT seconds. */
function windowOf(patch: PatchSpan): { start: number; end: number } {
  return { start: patch.startUt.magnitude, end: patch.endUt.magnitude };
}

const FULL_TURN = value("rad", 2 * Math.PI);

/**
 * The mean anomaly, in radians, `ut` reaches from `meanAnomalyAtEpoch` at
 * `meanMotion`: `M0 + n·(ut − epoch)`.
 *
 * Every term is a quantity up to the sum, and the sum is where the algebra
 * stops: what reads it is the Kepler solve, which is trigonometry on a number.
 * A propagation that advances a conic in time goes through here rather than
 * subtracting instants of its own, so the instant, the interval and the rate
 * keep their units right up to the solve.
 */
export function meanAnomalyAt(
  meanAnomalyAtEpoch: Value<"rad">,
  meanMotion: Value<"rad·s⁻¹">,
  epoch: Value<"ut">,
  ut: Value<"ut">,
): number {
  return meanAnomalyAtEpoch.plus(meanMotion.times(ut.minus(epoch))).magnitude;
}

/**
 * The craft's inertial state at `ut` on `patch`. The UT should lie inside the
 * patch's window; nothing is clamped, so picking the patch is the caller's.
 * Mean motion comes from the patch's own period.
 */
export function patchStateAt(patch: PatchConic, ut: number): InertialState {
  const M = meanAnomalyAt(
    patch.meanAnomalyAtEpoch,
    FULL_TURN.dividedBy(patch.period),
    patch.epoch,
    value("ut", ut),
  );
  const e = patch.ecc.magnitude;
  const E = solveEccentricAnomaly(M, e);
  const nu = trueAnomalyFromEccentric(E, e);
  const r = patch.sma.magnitude * (1 - e * Math.cos(E));

  // Perifocal frame: periapsis along +x, angular momentum along +z.
  const [x, y, z] = rotatePerifocalToInertial(
    r * Math.cos(nu),
    r * Math.sin(nu),
    degToRad(patch.inc.magnitude),
    degToRad(patch.lan.magnitude),
    degToRad(patch.argPe.magnitude),
  );

  return { x, y, z, radius: r };
}

/** Latitude, inertial longitude and altitude of an inertial state over a body of `bodyRadius`. */
export function geoFromInertial(
  state: InertialState,
  bodyRadius: number,
): GeoState {
  const lat = radToDeg(Math.asin(state.z / state.radius));
  const lonInertial = radToDeg(Math.atan2(state.y, state.x));
  return { lat, lonInertial, alt: state.radius - bodyRadius };
}

/** Whether the elliptical solve can propagate a patch. Hyperbolic and parabolic patches it cannot. */
export function isPatchElliptical(patch: PatchConic): boolean {
  return (
    patch.ecc.lessThan(1) &&
    patch.period.isFinite() &&
    patch.period.isPositive()
  );
}

/** Whether `ut` falls inside the patch's window, ends included. */
export function patchHolds(patch: PatchSpan, ut: number): boolean {
  const { start, end } = windowOf(patch);
  return ut >= start && ut <= end;
}

/**
 * `samples + 1` evenly spaced states across the patch's window, beginning no
 * earlier than `notBeforeUt`. Empty when nothing of the window is left.
 */
export function patchArc(
  patch: PatchSpan,
  samples: number,
  notBeforeUt?: number,
): { ut: number; state: InertialState }[] {
  const { start, end } = windowOf(patch);
  const from = notBeforeUt === undefined ? start : Math.max(start, notBeforeUt);
  if (!(end > from)) return [];
  const arc: { ut: number; state: InertialState }[] = [];
  for (let s = 0; s <= samples; s++) {
    const ut = from + ((end - from) * s) / samples;
    arc.push({ ut, state: patchStateAt(patch, ut) });
  }
  return arc;
}

/**
 * Ground points along the chain from `ref.ut`, every `stepSec`, out to
 * `horizonSec` ahead. The walk stays on `bodyId`: it ends at the first patch
 * around another body or on an orbit the elliptical solve cannot propagate.
 * Every sample is yielded, below the surface included, so where a walk stops
 * short of its horizon is the consumer's to say.
 *
 * Body-fixed longitude is calibrated against the observed ground position: the
 * inertial longitude the craft has at `ref.ut` IS `ref.lon`, and the surface
 * turns under it at the sidereal rate from there. The calibrating patch is the
 * one of `calibrationPatches` around `bodyId` that holds `ref.ut`, or the first
 * around it; a future chain that does not contain `ref.ut` (a node's post-burn
 * patches) passes the current chain here.
 */
export function* groundTrackSamples(
  patches: readonly PatchSpan[],
  bodyId: string,
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  horizonSec: number,
  stepSec: number,
  calibrationPatches: readonly PatchSpan[] = patches,
): Generator<TrackSample> {
  if (patches.length === 0 || stepSec <= 0 || horizonSec <= 0) return;

  // Calibration needs a patch around the named body, or the inertial longitude is in another frame.
  const calCandidates = calibrationPatches.filter(
    (p) => p.referenceBody === bodyId && isPatchElliptical(p),
  );
  const refPatch =
    calCandidates.find((p) => patchHolds(p, ref.ut)) ?? calCandidates[0];
  if (!refPatch) return;

  const refState = patchStateAt(refPatch, ref.ut);
  const rotationOffsetAtRef =
    radToDeg(Math.atan2(refState.y, refState.x)) - ref.lon;
  const omega = 360 / rotationPeriod;
  const endUT = ref.ut + horizonSec;

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.referenceBody !== bodyId) return;
    if (!isPatchElliptical(patch)) return;
    const { start, end } = windowOf(patch);
    if (end < ref.ut) continue;
    if (start > endUT) return;

    const from = Math.max(start, ref.ut);
    const to = Math.min(end, endUT);
    for (let ut = from; ut <= to; ut += stepSec) {
      const geo = geoFromInertial(patchStateAt(patch, ut), bodyRadius);
      const lon = wrap180(
        geo.lonInertial - rotationOffsetAtRef - omega * (ut - ref.ut),
      );
      yield { ut, lat: geo.lat, lon, alt: geo.alt, patchIndex };
    }
  }
}
