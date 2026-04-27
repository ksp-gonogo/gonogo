/**
 * Forward trajectory prediction on top of Telemachus orbit-patch data.
 *
 * The Keplerian elements in each `OrbitPatch` let us analytically propagate
 * the vessel's state forward in time within a single SOI. We don't attempt
 * N-body integration; Principia users need the `a.physicsMode === "n_body"`
 * guard in the consumer.
 *
 * KSP stock bodies all spin about the global +z inertial axis, so inertial
 * and body-fixed *latitudes* agree — only *longitude* needs a body-rotation
 * correction. We calibrate that correction against the vessel's current
 * `v.lat` / `v.long` / `t.universalTime` (the `PredictionRef`) so the drawn
 * prediction line connects to the ship icon exactly.
 */
import { PerfBudget } from "../perf/PerfBudget";
import type { OrbitPatch } from "../schemas/telemachus";

/**
 * Solve Kepler's equation `E - e·sin E = M` for the eccentric anomaly E.
 * Newton iteration; converges in <10 iterations for e < 0.95. Returns the
 * best value even if the tolerance isn't met (rare for stock KSP orbits).
 *
 * All angles in radians.
 */
export function solveKepler(
  meanAnomaly: number,
  eccentricity: number,
  tolerance = 1e-10,
  maxIterations = 50,
): number {
  const M = normalisePi(meanAnomaly);
  // Good initial guess for elliptical orbits: E0 = M + e·sin(M)
  let E = M + eccentricity * Math.sin(M);
  for (let i = 0; i < maxIterations; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fp = 1 - eccentricity * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < tolerance) return E;
  }
  return E;
}

/** Wrap an angle into (-π, π]. Helps Kepler converge cleanly. */
function normalisePi(rad: number): number {
  const twoPi = 2 * Math.PI;
  let x = rad % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x <= -Math.PI) x += twoPi;
  return x;
}

/** Wrap a degree value to (-180, 180]. */
export function wrap180(deg: number): number {
  let x = ((((deg + 180) % 360) + 360) % 360) - 180;
  // Avoid returning -180 exactly; prefer +180 for continuity.
  if (x <= -180) x = 180;
  return x;
}

/**
 * Convert an eccentric anomaly (radians) to true anomaly (radians) using
 * the half-angle formula, which is numerically well-behaved across all
 * quadrants.
 */
export function eccentricToTrueAnomaly(E: number, e: number): number {
  // tan(ν/2) = sqrt((1+e)/(1-e)) · tan(E/2)
  //        = (sqrt(1+e)·sin(E/2)) / (sqrt(1-e)·cos(E/2))
  const y = Math.sqrt(1 + e) * Math.sin(E / 2);
  const x = Math.sqrt(1 - e) * Math.cos(E / 2);
  return 2 * Math.atan2(y, x);
}

export interface InertialState {
  /** Body-centred inertial XYZ in metres. +z is the body's rotation axis. */
  x: number;
  y: number;
  z: number;
  /** Distance from body centre (||(x,y,z)||) in metres. */
  radius: number;
}

/**
 * Compute the vessel's inertial state at an arbitrary UT within `patch`.
 * The UT must lie inside `[patch.startUT, patch.endUT]`; no clamping is done
 * — the caller is expected to have picked the right patch.
 */
export function patchStateAt(patch: OrbitPatch, ut: number): InertialState {
  const dt = ut - patch.epoch;
  const n = (2 * Math.PI) / patch.period;
  const M = patch.maae + n * dt;
  const E = solveKepler(M, patch.eccentricity);
  const nu = eccentricToTrueAnomaly(E, patch.eccentricity);

  const r = patch.sma * (1 - patch.eccentricity * Math.cos(E));

  // Perifocal frame: periapsis along +x, angular momentum along +z.
  const xPf = r * Math.cos(nu);
  const yPf = r * Math.sin(nu);

  // Rotate perifocal → inertial via (argPe, inclination, LAN).
  // Standard 3-1-3 Euler rotation for Keplerian orbits.
  const w = (patch.argumentOfPeriapsis * Math.PI) / 180;
  const i = (patch.inclination * Math.PI) / 180;
  const O = (patch.lan * Math.PI) / 180;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosO = Math.cos(O);
  const sinO = Math.sin(O);

  // Columns of the perifocal-to-inertial rotation matrix. We only need the
  // first two columns because z_pf is always zero.
  const p0 = cosO * cosW - sinO * sinW * cosI;
  const p1 = sinO * cosW + cosO * sinW * cosI;
  const p2 = sinW * sinI;
  const q0 = -cosO * sinW - sinO * cosW * cosI;
  const q1 = -sinO * sinW + cosO * cosW * cosI;
  const q2 = cosW * sinI;

  const x = p0 * xPf + q0 * yPf;
  const y = p1 * xPf + q1 * yPf;
  const z = p2 * xPf + q2 * yPf;

  return { x, y, z, radius: r };
}

export interface GeoState {
  /** Latitude in degrees (KSP bodies have no axial tilt → inertial = body-fixed). */
  lat: number;
  /** Altitude above body surface in metres (can be negative transiently if below terrain). */
  alt: number;
  /** Inertial longitude in degrees. Use `applyBodyRotation` to get body-fixed. */
  lonInertial: number;
}

/** Extract lat / inertial-lon / altitude from an inertial state + body radius. */
export function geoFromInertial(
  state: InertialState,
  bodyRadius: number,
): GeoState {
  const lat = (Math.asin(state.z / state.radius) * 180) / Math.PI;
  const lonInertial = (Math.atan2(state.y, state.x) * 180) / Math.PI;
  return { lat, lonInertial, alt: state.radius - bodyRadius };
}

export interface PredictionRef {
  /** Current universal time in seconds — `t.universalTime`. */
  ut: number;
  /** Vessel latitude at `ut` in degrees — `v.lat`. */
  lat: number;
  /** Vessel (body-fixed) longitude at `ut` in degrees — `v.long`. */
  lon: number;
}

/**
 * Build a body-fixed-longitude converter calibrated against the vessel's
 * current ground position. KSP doesn't expose the absolute body rotation
 * angle we'd need to go from inertial longitude to body-fixed longitude in
 * a closed form, so we derive the offset from the observed `v.long`.
 *
 * `omega` is the body's rotation rate in degrees per second (360 /
 * rotationPeriod). Eastward rotation = positive omega.
 */
export function buildBodyRotation(
  referencePatch: OrbitPatch,
  ref: PredictionRef,
  rotationPeriod: number,
): (inertialLon: number, ut: number) => number {
  const refState = patchStateAt(referencePatch, ref.ut);
  const refInertialLon = (Math.atan2(refState.y, refState.x) * 180) / Math.PI;
  // rotationOffset such that: lon_body = lon_inertial - rotationOffset - omega·(t - ref.ut)
  // At t = ref.ut, lon_body = ref.lon, so rotationOffset = refInertialLon - ref.lon.
  const rotationOffsetAtRef = refInertialLon - ref.lon;
  const omega = 360 / rotationPeriod;
  return (inertialLon: number, ut: number): number =>
    wrap180(inertialLon - rotationOffsetAtRef - omega * (ut - ref.ut));
}

export interface TrackSample {
  ut: number;
  lat: number;
  lon: number;
  alt: number;
  /** Index into the `patches` array the sample was drawn from. */
  patchIndex: number;
}

/** Upper bound on sample count per `predictGroundTrack` call. */
export const MAX_TRACK_SAMPLES = 500;

/**
 * Soft cap on `predictGroundTrack` invocations. MapView re-runs the
 * prediction whenever its inputs change — orbit patches change rarely
 * (SOI changes, maneuvers), but `universalTime` ticks 4×/sec and used
 * to invalidate the memo on every tick. After the throttle that
 * quantises the ut bucket to 1 Hz, normal use should be ~1/sec across
 * one MapView, plus per-maneuver-node samples on top. Budget at 30/sec
 * gives plenty of headroom for several MapView instances + multiple
 * maneuver nodes without hiding a real regression.
 */
const PREDICT_GROUND_TRACK_BUDGET = new PerfBudget({
  name: "predictGroundTrack calls/sec",
  threshold: 30,
  windowMs: 1000,
  unit: "calls",
});

/** Minimum altitude above surface to keep sampling; below this we terminate. */
const MIN_RENDER_ALT_M = -100;

/**
 * Sample a predicted ground track across one or more patches sharing the
 * same reference body. Stops at the first patch boundary where the
 * reference body changes (SOI transition) — multi-SOI rendering is a
 * separate feature.
 *
 * @param patches All orbit patches (as returned by `o.orbitPatches`).
 * @param bodyId  The body to render prediction for. Patches for other bodies are skipped.
 * @param bodyRadius Body mean radius in metres (for altitude calculation).
 * @param rotationPeriod Body sidereal rotation period in seconds.
 * @param ref Current vessel state (ut / lat / lon) — calibrates body rotation.
 * @param horizonSec Maximum prediction horizon from `ref.ut`.
 * @param stepSec Sample interval in seconds.
 */
/** A patch is propagable with our elliptical solver. Hyperbolic and parabolic trajectories aren't. */
function isPatchElliptical(patch: OrbitPatch): boolean {
  return (
    patch.eccentricity < 1 && Number.isFinite(patch.period) && patch.period > 0
  );
}

export function predictGroundTrack(
  patches: readonly OrbitPatch[],
  bodyId: string,
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  horizonSec: number,
  stepSec: number,
  /**
   * Patches used to calibrate body rotation against `ref`. Defaults to
   * `patches`. Override when rendering a future trajectory (e.g. a maneuver
   * node's post-burn patches) that doesn't contain `ref.ut` — pass the
   * current `o.orbitPatches` so the calibration comes from the patch the
   * vessel is actually in right now.
   */
  calibrationPatches: readonly OrbitPatch[] = patches,
): TrackSample[] {
  PREDICT_GROUND_TRACK_BUDGET.record();
  if (patches.length === 0 || stepSec <= 0 || horizonSec <= 0) return [];

  // We calibrate body rotation off whichever calibration patch contains
  // `ref.ut`, falling back to the first elliptical patch for the named body.
  // Calibration has to use a patch orbiting the named body; otherwise the
  // inertial longitude is in a different frame.
  const calCandidates = calibrationPatches.filter(
    (p) => p.referenceBody === bodyId && isPatchElliptical(p),
  );
  const refPatch =
    calCandidates.find((p) => ref.ut >= p.startUT && ref.ut <= p.endUT) ??
    calCandidates[0];
  if (!refPatch) return [];

  const toBodyLon = buildBodyRotation(refPatch, ref, rotationPeriod);

  // Enforce an upper bound on sample count by floor-ing the step to
  // horizon / MAX. Keeps long-period orbits (solar, interplanetary) cheap
  // without starving short orbits.
  const effectiveStep = Math.max(stepSec, horizonSec / MAX_TRACK_SAMPLES);

  const samples: TrackSample[] = [];
  const endUT = ref.ut + horizonSec;

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.referenceBody !== bodyId) break; // SOI change — stop.
    if (!isPatchElliptical(patch)) break; // Hyperbolic/parabolic — not supported in v1.
    if (patch.endUT < ref.ut) continue; // Already finished.
    if (patch.startUT > endUT) break; // Past horizon.

    const from = Math.max(patch.startUT, ref.ut);
    const to = Math.min(patch.endUT, endUT);
    let terminated = false;
    for (let ut = from; ut <= to; ut += effectiveStep) {
      const state = patchStateAt(patch, ut);
      const geo = geoFromInertial(state, bodyRadius);
      if (geo.alt < MIN_RENDER_ALT_M) {
        // Vessel has dipped below the surface — treat as impact and stop
        // sampling further patches too. The previous sample is the last
        // visible point; the impact marker is rendered separately at
        // `land.predictedLat/Lon` when available.
        terminated = true;
        break;
      }
      const lon = toBodyLon(geo.lonInertial, ut);
      samples.push({ ut, lat: geo.lat, lon, alt: geo.alt, patchIndex });
    }
    if (terminated) break;
  }

  return samples;
}

/**
 * Break a list of lat/lon samples into contiguous polyline segments,
 * inserting a break whenever consecutive longitudes jump by more than
 * `wrapThresholdDeg` — the telltale signature of an equirectangular
 * date-line crossing. Preserves sample order within each segment.
 */
export function splitOnLongitudeWrap<T extends { lon: number }>(
  samples: readonly T[],
  wrapThresholdDeg = 180,
): T[][] {
  if (samples.length === 0) return [];
  const segments: T[][] = [[samples[0]]];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (Math.abs(curr.lon - prev.lon) > wrapThresholdDeg) {
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }
  return segments;
}
