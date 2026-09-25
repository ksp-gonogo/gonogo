/**
 * Where a descending craft will meet the surface, answered by the shape of the
 * trajectory the elected propagation provider vouches for.
 *
 * The descent itself (terrain below, falling toward it, a finite gravity) is
 * measured off `vessel.flight` and `vessel.orbit.mu`. WHERE it ends is a
 * propagation, and a propagation is the provider's to authorise: the answer
 * comes from `orbitTrajectory` on the same `vessel.orbit` sample, and each of
 * its three shapes gets its own treatment rather than a Kepler walk run
 * regardless of what the provider said.
 *
 * - conic: the vacuum-ballistic walk over the patch chain, stopped where the
 *   provider's horizon stops, so an impact past its reach is not answered
 * - arc: the first surface crossing on the provider's own sampled points
 * - withheld: no impact point, because there is no trajectory to find one on
 *
 * Vacuum throughout, ignoring drag, so on an atmospheric body the point is
 * where a craft with no air would land.
 */

import { type PayloadMeta, Quality } from "../__generated__/contract";
import { magnitudeOr, type Quantityish } from "../magnitude";
import {
  canPropagate,
  rotatePerifocalToInertial,
  solveEccentricAnomaly,
  type Vector3,
} from "./kepler";
import { buildElements } from "./kepler-reckoning";
import {
  type LegacyOrbitPatch,
  mapOrbitPatch,
  type OrbitPatchWirePayload,
} from "./orbit-patches";
import {
  type OrbitTrajectoryInput,
  orbitTrajectory,
  type TrajectoryArcAnswer,
  TrajectoryFrameKindLike,
  type TrajectoryPoint,
} from "./orbit-trajectory";
import { type BodyRadiusTable, bodyRadiusOf } from "./orbital-solve";

function eccentricToTrueAnomaly(E: number, e: number): number {
  const y = Math.sqrt(1 + e) * Math.sin(E / 2);
  const x = Math.sqrt(1 - e) * Math.cos(E / 2);
  return 2 * Math.atan2(y, x);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wrap a degree value to (-180, 180]. */
function wrap180(deg: number): number {
  let x = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (x <= -180) x = 180;
  return x;
}

interface InertialState {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * Vessel's inertial state at an arbitrary UT within `patch`, the same math as
 * `@ksp-gonogo/core`'s `predictGroundTrack` uses for the rendered ground track.
 * That walk lives where this package cannot import it, so the patch walk and
 * the perifocal rotation are carried here too. The Kepler SOLVE is not: there
 * is one solver, `kepler.ts`'s `solveEccentricAnomaly`, and
 * `kepler-conformance.test.ts` fails if a second appears anywhere in the repo.
 */
function patchStateAt(patch: LegacyOrbitPatch, ut: number): InertialState {
  const dt = ut - patch.epoch;
  const n = (2 * Math.PI) / patch.period;
  const M = patch.maae + n * dt;
  const E = solveEccentricAnomaly(M, patch.eccentricity);
  const nu = eccentricToTrueAnomaly(E, patch.eccentricity);
  const r = patch.sma * (1 - patch.eccentricity * Math.cos(E));

  const xPf = r * Math.cos(nu);
  const yPf = r * Math.sin(nu);

  const w = degToRad(patch.argumentOfPeriapsis);
  const i = degToRad(patch.inclination);
  const O = degToRad(patch.lan);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosO = Math.cos(O);
  const sinO = Math.sin(O);

  const p0 = cosO * cosW - sinO * sinW * cosI;
  const p1 = sinO * cosW + cosO * sinW * cosI;
  const p2 = sinW * sinI;
  const q0 = -cosO * sinW - sinO * cosW * cosI;
  const q1 = -sinO * sinW + cosO * cosW * cosI;
  const q2 = cosW * sinI;

  return {
    x: p0 * xPf + q0 * yPf,
    y: p1 * xPf + q1 * yPf,
    z: p2 * xPf + q2 * yPf,
    radius: r,
  };
}

interface GeoState {
  lat: number;
  alt: number;
  lonInertial: number;
}

function geoFromInertial(state: InertialState, bodyRadius: number): GeoState {
  const lat = radToDeg(Math.asin(state.z / state.radius));
  const lonInertial = radToDeg(Math.atan2(state.y, state.x));
  return { lat, lonInertial, alt: state.radius - bodyRadius };
}

export interface PredictionRef {
  /** Current universal time, seconds. */
  ut: number;
  /** Vessel latitude at `ut`, degrees. */
  lat: number;
  /** Vessel body-fixed longitude at `ut`, degrees. */
  lon: number;
}

/**
 * A body-fixed-longitude converter calibrated against the vessel's observed
 * ground position: the inertial longitude it has at `ref.ut` IS `ref.lon`, and
 * the surface turns under it at the body's sidereal rate from there.
 */
function calibratedLongitude(
  inertialLonAtRef: number,
  ref: PredictionRef,
  rotationPeriod: number,
): (inertialLon: number, ut: number) => number {
  const rotationOffsetAtRef = inertialLonAtRef - ref.lon;
  const omega = 360 / rotationPeriod;
  return (inertialLon: number, ut: number): number =>
    wrap180(inertialLon - rotationOffsetAtRef - omega * (ut - ref.ut));
}

/** A patch is propagable with the elliptical solver above, hyperbolic/parabolic trajectories aren't. */
function isPatchElliptical(patch: LegacyOrbitPatch): boolean {
  return (
    patch.eccentricity < 1 && Number.isFinite(patch.period) && patch.period > 0
  );
}

/** Altitude below which a point counts as at or below the surface, the same threshold `predictGroundTrack` uses. */
const MIN_IMPACT_ALT_M = -100;

export interface ImpactPoint {
  lat: number;
  lon: number;
}

/**
 * Walks the patch chain forward from `ref.ut` and returns the LAST sample
 * before altitude drops below `MIN_IMPACT_ALT_M`: the predicted surface
 * impact point. `null` when the walk never dips below the surface within
 * `horizonSec`, never a fabricated `(0,0)`. Bound `horizonSec`/`stepSec`
 * tightly at the call site: this is an O(horizonSec / stepSec) loop with no
 * internal sample cap.
 */
export function findImpactPoint(
  patches: readonly LegacyOrbitPatch[],
  bodyId: string,
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  horizonSec: number,
  stepSec: number,
): ImpactPoint | null {
  if (patches.length === 0 || stepSec <= 0 || horizonSec <= 0) return null;

  const calCandidates = patches.filter(
    (p) => p.referenceBody === bodyId && isPatchElliptical(p),
  );
  const refPatch =
    calCandidates.find((p) => ref.ut >= p.startUT && ref.ut <= p.endUT) ??
    calCandidates[0];
  if (!refPatch) return null;

  const refState = patchStateAt(refPatch, ref.ut);
  const toBodyLon = calibratedLongitude(
    radToDeg(Math.atan2(refState.y, refState.x)),
    ref,
    rotationPeriod,
  );
  const endUT = ref.ut + horizonSec;

  let last: ImpactPoint | null = null;
  for (const patch of patches) {
    if (patch.referenceBody !== bodyId) break; // SOI change, stop.
    if (!isPatchElliptical(patch)) break;
    if (patch.endUT < ref.ut) continue; // Already finished.
    if (patch.startUT > endUT) break; // Past horizon.

    const from = Math.max(patch.startUT, ref.ut);
    const to = Math.min(patch.endUT, endUT);
    for (let ut = from; ut <= to; ut += stepSec) {
      const state = patchStateAt(patch, ut);
      const geo = geoFromInertial(state, bodyRadius);
      if (geo.alt < MIN_IMPACT_ALT_M) {
        return last;
      }
      last = { lat: geo.lat, lon: toBodyLon(geo.lonInertial, ut) };
    }
  }
  return null;
}

/**
 * Sidereal rotation period (seconds) for the stock KSP bodies, hand-mirrored
 * from `@ksp-gonogo/core`'s static body registry
 * (`packages/core/src/stock-bodies.ts`), which this package cannot import.
 * Only a fallback: `system.bodies` reports the period per body, and this
 * answers for a stock game whose stream predates that field and for nothing
 * else. A body in neither gets no impact point. Keep in sync if
 * `stock-bodies.ts`'s rotation periods change.
 */
export const ROTATION_PERIOD_SECONDS: Readonly<Record<string, number>> = {
  Kerbol: 432000,
  Moho: 1210000,
  Eve: 80500,
  Gilly: 28255,
  Kerbin: 21549.425,
  Mun: 138984.38,
  Minmus: 40400,
  Duna: 65517.859,
  Ike: 65517.862,
  Dres: 34800,
  Jool: 36000,
  Laythe: 52980.879,
  Vall: 105962.09,
  Tylo: 211926.36,
  Bop: 544507.43,
  Pol: 901902.62,
  Eeloo: 19460,
};

/**
 * Bound on how far ahead the impact is looked for: 1.5x the closed-form
 * vertical fall time, capped at 20 minutes. The margin is there because the
 * vertical-only fall and the full three-dimensional path do not reach the
 * surface at exactly the same instant; the cap keeps a bad closed-form estimate
 * from turning into an unbounded walk.
 */
const IMPACT_WALK_HORIZON_MULTIPLIER = 1.5;
const IMPACT_WALK_MAX_HORIZON_SEC = 1200;
/** ~60 samples across the bounded horizon: precise enough for a landing-site marker, cheap enough to run on every frame of a descent. */
const IMPACT_WALK_MIN_STEPS = 60;

/** The `system.bodies` fields the impact point reads. */
export interface ImpactBodyTable extends BodyRadiusTable {
  bodies: readonly {
    index: number;
    radius?: Quantityish;
    rotationPeriod?: Quantityish;
  }[];
}

export interface ImpactPointInput {
  /**
   * The `vessel.orbit` sample, whole, in wire units. Whole for the reason
   * `orbitTrajectory` takes it whole: the horizon, the arc and the patch chain
   * that answer for one instant have to come from one sample.
   */
  orbit: OrbitTrajectoryInput["orbit"] & {
    referenceBodyIndex?: number;
    patches?: readonly OrbitPatchWirePayload[] | null;
    meta?: PayloadMeta | null;
  };
  /** The `vessel.flight` sample at the same instant. */
  flight: {
    latitude: Quantityish;
    longitude: Quantityish;
    altitudeAsl: Quantityish;
    altitudeTerrain: Quantityish;
    verticalSpeed: Quantityish;
  };
  bodies: ImpactBodyTable | null | undefined;
  /** The instant the answer is for. */
  viewUt: number;
}

/**
 * A wire quantity's magnitude, or `NaN` when the field is absent, so an absent
 * field falls through every `> 0` and `Number.isFinite` guard below rather than
 * reading as zero.
 */
function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

/**
 * The sidereal rotation period `system.bodies` reports for the body at
 * `index`, or `undefined` when it reports none a walk could divide by.
 */
function rotationPeriodOf(
  bodies: ImpactBodyTable | null | undefined,
  index: number | undefined,
): number | undefined {
  if (index == null || bodies == null) return undefined;
  const seconds = mag(
    bodies.bodies.find((b) => b.index === index)?.rotationPeriod,
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * The predicted surface impact point, or `null` when there is none to give.
 *
 * `null` unless the craft is descending (`verticalSpeed < 0`) toward terrain
 * still below it (`altitudeTerrain > 0`), the body's radius and a finite,
 * positive gravity `mu/(radius+altitudeAsl)^2` resolve, and something reports
 * the body's rotation period. Beyond those, the trajectory's shape decides, as
 * the module doc lays out.
 *
 * A measured-basis figure: `null` while the orbit's own `meta.quality` is
 * `OnRails`, which is the basis the envelope carries too. A sample with no
 * payload meta names no basis and is answered on the measurements alone.
 *
 * An answer for the instant it is handed and no other: nothing here carries a
 * descent forward past the observation it was computed from, so a reader
 * wanting it for a later instant hands it that instant's samples.
 */
export function predictImpactPoint(
  input: ImpactPointInput,
): ImpactPoint | null {
  const { orbit, flight, bodies, viewUt } = input;
  if (orbit.meta?.quality === Quality.OnRails) return null;
  const h = mag(flight.altitudeTerrain);
  const vDown = -mag(flight.verticalSpeed);
  if (!(h > 0) || !(vDown > 0)) return null;

  const radius = bodyRadiusOf(bodies, orbit.referenceBodyIndex);
  if (radius == null) return null;
  const alt = mag(flight.altitudeAsl);
  const g = mag(orbit.mu) / ((radius + alt) * (radius + alt));
  if (!(g > 0) || !Number.isFinite(g)) return null;

  // Ballistic no-burn fall to terrain: positive root of ½g·t² + vDown·t − h = 0.
  // It bounds the search rather than being an answer itself.
  const timeToImpact = (-vDown + Math.sqrt(vDown * vDown + 2 * g * h)) / g;
  if (!(timeToImpact > 0) || !Number.isFinite(timeToImpact)) return null;
  const walkSec = Math.min(
    timeToImpact * IMPACT_WALK_HORIZON_MULTIPLIER,
    IMPACT_WALK_MAX_HORIZON_SEC,
  );

  const patches = (orbit.patches ?? []).map(mapOrbitPatch);
  /*
   * The stream's own figure first. The stock table behind it is keyed by NAME
   * and only carries stock bodies, so it answers for a stock game whose stream
   * predates the field and for nothing else.
   */
  const rotationPeriod =
    rotationPeriodOf(bodies, orbit.referenceBodyIndex) ??
    (patches.length > 0
      ? ROTATION_PERIOD_SECONDS[patches[0].referenceBody]
      : undefined);
  if (rotationPeriod == null) return null;

  const ref: PredictionRef = {
    ut: viewUt,
    lat: mag(flight.latitude),
    lon: mag(flight.longitude),
  };
  const trajectory = orbitTrajectory({ orbit, viewUt });
  switch (trajectory.shape) {
    case "withheld":
      return null;
    case "conic":
      return conicImpact(
        patches,
        orbit.horizon,
        radius,
        rotationPeriod,
        ref,
        walkSec,
      );
    case "arc":
      return arcImpact(trajectory, orbit, radius, rotationPeriod, ref, walkSec);
  }
}

/**
 * The patch walk, out to the nearer of the fall bound and the provider's
 * horizon. The step is set by the fall bound alone, so a horizon that does not
 * bite leaves the samples, and so the point, exactly where they would be with
 * no horizon at all.
 */
function conicImpact(
  patches: readonly LegacyOrbitPatch[],
  horizon: ImpactPointInput["orbit"]["horizon"],
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  walkSec: number,
): ImpactPoint | null {
  if (patches.length === 0) return null;
  const reach = canPropagate(horizon, ref.ut, ref.ut + walkSec);
  const reachSec = reach.propagatable
    ? walkSec
    : reach.reason === "past-horizon"
      ? reach.horizonUt - ref.ut
      : 0;
  if (!(reachSec > 0)) return null;
  return findImpactPoint(
    patches,
    patches[0].referenceBody,
    bodyRadius,
    rotationPeriod,
    ref,
    reachSec,
    Math.max(1, walkSec / IMPACT_WALK_MIN_STEPS),
  );
}

function lerpPoint(
  a: TrajectoryPoint,
  b: TrajectoryPoint,
  f: number,
): TrajectoryPoint {
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    ut: a.ut + (b.ut - a.ut) * f,
  };
}

/**
 * The first surface crossing on the provider's sampled arc, inside the fall
 * bound.
 *
 * A latitude and longitude need the point in a frame whose z axis is the
 * body's spin axis and whose centre is the body itself. The two frames an arc
 * can arrive in that give that are the perifocal frame of these elements, which
 * the elements' own rotation lifts back into the body-centred inertial frame
 * they are measured in, and that inertial frame directly. Any other frame, a
 * different centre, or lengths that are not metres answers no impact rather
 * than a guess, and never falls back to a conic the provider did not offer.
 *
 * The longitude is calibrated the same way as the conic walk's: the craft's
 * inertial longitude at the view instant, read off the arc itself, IS its
 * observed longitude, and the surface turns under the path at the body's
 * sidereal rate from there to the crossing instant. An arc that does not span
 * the view instant cannot be calibrated and gives no point.
 */
function arcImpact(
  arc: TrajectoryArcAnswer,
  orbit: ImpactPointInput["orbit"],
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  walkSec: number,
): ImpactPoint | null {
  const { frame } = arc;
  if (frame.lengthsPulsate) return null;
  if (
    frame.centreBodyIndex !== undefined &&
    frame.centreBodyIndex !== orbit.referenceBodyIndex
  ) {
    return null;
  }
  let lift: (p: TrajectoryPoint) => Vector3;
  if (frame.kind === TrajectoryFrameKindLike.BodyCentredInertial) {
    lift = (p) => [p.x, p.y, p.z];
  } else if (frame.kind === TrajectoryFrameKindLike.Perifocal) {
    const { inc, lan, argPe } = buildElements(orbit);
    const pHat = rotatePerifocalToInertial(1, 0, inc, lan, argPe);
    const qHat = rotatePerifocalToInertial(0, 1, inc, lan, argPe);
    const wHat: Vector3 = [
      pHat[1] * qHat[2] - pHat[2] * qHat[1],
      pHat[2] * qHat[0] - pHat[0] * qHat[2],
      pHat[0] * qHat[1] - pHat[1] * qHat[0],
    ];
    lift = (p) => [
      p.x * pHat[0] + p.y * qHat[0] + p.z * wHat[0],
      p.x * pHat[1] + p.y * qHat[1] + p.z * wHat[1],
      p.x * pHat[2] + p.y * qHat[2] + p.z * wHat[2],
    ];
  } else {
    return null;
  }

  const surface = bodyRadius + MIN_IMPACT_ALT_M;
  const endUt = ref.ut + walkSec;
  const points = arc.points;
  const startAt = points.findIndex(
    (p, i) => i > 0 && points[i - 1].ut <= ref.ut && p.ut >= ref.ut,
  );
  if (startAt < 0) return null;
  const before = points[startAt - 1];
  const after = points[startAt];
  const span = after.ut - before.ut;
  const start = lift(
    lerpPoint(before, after, span > 0 ? (ref.ut - before.ut) / span : 0),
  );
  const toBodyLon = calibratedLongitude(
    radToDeg(Math.atan2(start[1], start[0])),
    ref,
    rotationPeriod,
  );

  let previous: { at: Vector3; ut: number } = { at: start, ut: ref.ut };
  for (let i = startAt; i < points.length; i++) {
    const next = { at: lift(points[i]), ut: points[i].ut };
    if (next.ut <= previous.ut) continue;
    const rPrev = Math.hypot(...previous.at);
    const rNext = Math.hypot(...next.at);
    if (rPrev < surface) return null;
    if (rNext < surface) {
      const f = (rPrev - surface) / (rPrev - rNext);
      const ut = previous.ut + (next.ut - previous.ut) * f;
      if (ut > endUt) return null;
      const at: Vector3 = [
        previous.at[0] + (next.at[0] - previous.at[0]) * f,
        previous.at[1] + (next.at[1] - previous.at[1]) * f,
        previous.at[2] + (next.at[2] - previous.at[2]) * f,
      ];
      const r = Math.hypot(...at);
      const lat = radToDeg(Math.asin(at[2] / r));
      const lon = toBodyLon(radToDeg(Math.atan2(at[1], at[0])), ut);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    }
    if (next.ut > endUt) return null;
    previous = next;
  }
  return null;
}
