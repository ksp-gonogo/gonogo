/**
 * The patch chain the wire carries (`vessel.orbit.patches`, and each
 * `vessel.maneuver.nodes[].patches`), propagated through the one Kepler solve
 * and laid over a turning body's surface. The ground track and the impact
 * point are both this walk; they differ only in where they stop.
 */
import type { OrbitPatch } from "../__generated__/contract";
import { type Value, value } from "../unit-system/value";
import { rotatePerifocalToInertial, solveConic } from "./kepler";
import { mag } from "./kepler-reckoning";

/**
 * The orbital elements of one patch of a vessel's predicted path: the shape,
 * orientation, epoch and period a propagation reads. Useful for solving where the
 * vessel is on that patch at a given instant.
 */
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
  | "mu"
>;

/**
 * A patch with every element a propagation reads present. The wire sends
 * `lan`, `argPe` and `meanAnomalyAtEpoch` as null where KSP left them
 * undefined, and such a patch cannot be propagated. `period` stays absent on
 * an open patch, which is carried by its `mu`; {@link canPropagatePatch}
 * checks that whichever of the two the patch needs is there.
 */
export type PropagablePatch = Omit<
  PatchConic,
  "lan" | "argPe" | "meanAnomalyAtEpoch"
> & {
  [Element in "lan" | "argPe" | "meanAnomalyAtEpoch"]: NonNullable<
    PatchConic[Element]
  >;
};

/**
 * A patch's elements with the window of universal time it holds for and the body
 * it is around. Useful for choosing which patch of the predicted path covers a
 * given instant. Taken by the ground-track prediction and by the system
 * diagram's predicted trajectory.
 */
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

/**
 * Wrap an angle in degrees to (-180, 180], preferring +180 for continuity. Useful
 * for keeping a longitude or an angle difference in a range the operator can
 * read. Used by the ground-track prediction.
 */
export function wrap180(deg: number): number {
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
 * A patch's mean motion: a full turn over its period where it has one, and
 * `sqrt(mu / |sma|³)` on an open patch, which has none. `NaN` where the patch
 * carries neither, which {@link canPropagatePatch} rules out.
 */
function patchMeanMotion(patch: PropagablePatch): Value<"rad·s⁻¹"> {
  if (patch.period != null) return FULL_TURN.dividedBy(patch.period);
  const size = Math.abs(mag(patch.sma));
  return value("rad·s⁻¹", Math.sqrt(mag(patch.mu) / size ** 3));
}

/**
 * The craft's inertial state at `ut` on `patch`. The UT should lie inside the
 * patch's window; nothing is clamped, so picking the patch is the caller's.
 * Mean motion comes from the patch's own period, or on an open patch from its
 * own gravitational parameter.
 */
export function patchStateAt(
  patch: PropagablePatch,
  ut: number,
): InertialState {
  const { trueAnomaly, radius } = solveConic(
    patch,
    patchMeanMotion(patch),
    value("ut", ut),
  );

  // Perifocal frame: periapsis along +x, angular momentum along +z.
  const [x, y, z] = rotatePerifocalToInertial(
    radius * Math.cos(trueAnomaly),
    radius * Math.sin(trueAnomaly),
    degToRad(patch.inc.magnitude),
    degToRad(patch.lan.magnitude),
    degToRad(patch.argPe.magnitude),
  );

  return { x, y, z, radius };
}

/**
 * The latitude, inertial longitude and altitude of an inertial state over a body
 * of radius `bodyRadius`. Useful for turning a predicted position into the point
 * on the surface below it.
 */
export function geoFromInertial(
  state: InertialState,
  bodyRadius: number,
): GeoState {
  const lat = radToDeg(Math.asin(state.z / state.radius));
  const lonInertial = radToDeg(Math.atan2(state.y, state.x));
  return { lat, lonInertial, alt: state.radius - bodyRadius };
}

/**
 * Whether a patch can be propagated. A closed patch needs its period. An open
 * one (`ecc` above 1) has none and needs its gravitational parameter, which a
 * patch off an older recording may lack. A parabolic patch (`ecc` exactly 1)
 * cannot be, and neither can one whose `lan`, `argPe` or `meanAnomalyAtEpoch`
 * is null.
 */
export function canPropagatePatch<Patch extends PatchConic>(
  patch: Patch,
): patch is Patch & PropagablePatch {
  if (
    patch.lan == null ||
    patch.argPe == null ||
    patch.meanAnomalyAtEpoch == null
  ) {
    return false;
  }
  if (patch.ecc.lessThan(1)) {
    return patch.period?.isFinite() === true && patch.period.isPositive();
  }
  if (!patch.ecc.greaterThan(1)) return false;
  return (
    patch.mu?.isFinite() === true &&
    patch.mu.isPositive() &&
    patch.sma.isFinite() &&
    !patch.sma.isZero()
  );
}

/**
 * Whether `ut` falls inside the patch's window, ends included. Useful for
 * choosing which patch of the predicted path applies at an instant. Used by the
 * system diagram's predicted trajectory.
 */
export function patchHolds(patch: PatchSpan, ut: number): boolean {
  const { start, end } = windowOf(patch);
  return ut >= start && ut <= end;
}

/**
 * `samples + 1` evenly spaced states across a patch's window, beginning no
 * earlier than `notBeforeUt`. Useful for drawing the part of a predicted patch
 * still ahead of the vessel. Used by the system diagram's predicted trajectory.
 * The result is empty when nothing of the window is left.
 */
export function patchArc(
  patch: PatchSpan & PropagablePatch,
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
 * Points on the surface below the vessel's predicted path, from `ref.ut`, every
 * `stepSec`, out to `horizonSec` ahead. Useful for drawing the operator the
 * ground track the vessel will follow. Used by the ground-track prediction.
 *
 * The walk stays on `bodyId`: it ends at the first patch around another body or
 * on an orbit the elliptical solve cannot propagate. Every sample is yielded,
 * below the surface included, so where a walk stops short of its horizon is the
 * consumer's to say.
 *
 * Body-fixed longitude is calibrated against the observed ground position: the
 * inertial longitude the vessel has at `ref.ut` is `ref.lon`, and the surface
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
    (p): p is PatchSpan & PropagablePatch =>
      p.referenceBody === bodyId && canPropagatePatch(p),
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
    if (!canPropagatePatch(patch)) return;
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
