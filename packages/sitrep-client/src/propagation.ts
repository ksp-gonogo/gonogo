/**
 * Client-side orbit-derivation helpers built on top of the analytic Kepler
 * propagator (`kepler.ts`). These are the "orbit Uplink SDK" pieces: the
 * mod streams sparse orbital ELEMENTS (plus the next SOI
 * `encounter`), and the SDK reconstructs everything a widget used to read as a
 * precomputed Telemachus scalar — closest-approach UT, a post-burn maneuver
 * preview, and the patched-conic chain — client-side.
 *
 * Everything here is deterministic and side-effect-free (no wall-clock, no
 * RNG), the same discipline as `kepler.ts` — it all bottoms out in `solve`/
 * `solveAnomalies`, so it inherits the C#-conformance the golden fixtures pin.
 * Only elliptical orbits (0 <= ecc < 1) are supported for the anomaly-based
 * pieces; `rvToElements` can emit a hyperbolic result (a post-burn escape
 * trajectory) and flags it so callers can degrade gracefully.
 */

import type { OrbitElements, StateVector, Vector3 } from "./kepler";
import { solve } from "./kepler";

const TWO_PI = 2 * Math.PI;
/** Standard gravity used by KSP's own TWR / ΔV readouts (m/s²). */
export const STANDARD_GRAVITY = 9.80665;

// ── small vector helpers (Vector3 is a readonly [x,y,z] tuple) ──────────────

function sub(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vector3, s: number): Vector3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(a: Vector3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vector3): Vector3 {
  const m = magnitude(a);
  return m === 0 ? [0, 0, 0] : scale(a, 1 / m);
}

/** Orbital period (seconds) of an ellipse — `2π·sqrt(sma³/mu)`. `null` for a non-bound (sma ≤ 0) or non-finite orbit. */
export function orbitalPeriod(elements: OrbitElements): number | null {
  if (elements.sma <= 0 || !Number.isFinite(elements.sma)) return null;
  const period = TWO_PI * Math.sqrt(elements.sma ** 3 / elements.mu);
  return Number.isFinite(period) ? period : null;
}

// ── closest approach ────────────────────────────────────────────────────────

/** Result of a two-body closest-approach solve. */
export interface ClosestApproach {
  /** UT (seconds) of the minimum separation within the searched horizon. */
  ut: number;
  /** Separation (metres) at `ut`. */
  distance: number;
}

export interface ClosestApproachOptions {
  /**
   * How far ahead of `startUt` to search (seconds). Defaults to the two
   * orbits' synodic period (the interval over which their relative geometry
   * repeats), capped so a near-resonant pair with an enormous synodic period
   * still terminates.
   */
  horizonSeconds?: number;
  /** Coarse-scan sample count across the horizon. Default 1440 (¼° of a co-orbital pair). */
  coarseSamples?: number;
}

const MAX_HORIZON_SECONDS = 100 * 365 * 24 * 3600; // 100 Kerbin-ish years — a terminating cap
const GOLDEN_REFINE_ITERATIONS = 60;

function separationAt(
  self: OrbitElements,
  target: OrbitElements,
  ut: number,
): number {
  const a = solve(self, ut).position;
  const b = solve(target, ut).position;
  return magnitude(sub(a, b));
}

/**
 * Two-body closest-approach solve over `self` and `target` — the SDK-side
 * replacement for Telemachus's precomputed `o.closestTgtApprUT`
 * (DistanceToTarget). Both orbits MUST be around the same body (same `mu`,
 * same reference frame) — the caller is responsible for that gate (a
 * cross-SOI approach isn't a single two-body problem). Returns the UT of
 * minimum separation at or after `startUt` and the separation there, or
 * `null` for a degenerate/non-finite orbit.
 *
 * Coarse-scans the search horizon for the best bracket, then golden-section
 * refines it — separation is smooth and (over one synodic period) has a
 * single dominant minimum, so a bracket-then-refine is both cheap and
 * robust. Deterministic: same inputs → same output.
 */
export function closestApproach(
  self: OrbitElements,
  target: OrbitElements,
  startUt: number,
  options: ClosestApproachOptions = {},
): ClosestApproach | null {
  const selfPeriod = orbitalPeriod(self);
  const targetPeriod = orbitalPeriod(target);
  if (selfPeriod === null || targetPeriod === null) return null;

  let horizon = options.horizonSeconds;
  if (horizon === undefined) {
    const relRate = Math.abs(1 / selfPeriod - 1 / targetPeriod);
    // Co-orbital (identical periods): the geometry is static, so one period
    // covers every phase. Otherwise the synodic period is the repeat window.
    horizon = relRate === 0 ? selfPeriod : 1 / relRate;
  }
  if (!Number.isFinite(horizon) || horizon <= 0) horizon = selfPeriod;
  horizon = Math.min(horizon, MAX_HORIZON_SECONDS);

  const samples = Math.max(2, options.coarseSamples ?? 1440);
  const step = horizon / samples;

  let bestUt = startUt;
  let bestDist = separationAt(self, target, startUt);
  for (let i = 1; i <= samples; i++) {
    const ut = startUt + i * step;
    const d = separationAt(self, target, ut);
    if (d < bestDist) {
      bestDist = d;
      bestUt = ut;
    }
  }
  if (!Number.isFinite(bestDist)) return null;

  // Golden-section refine within the bracket straddling the coarse minimum.
  let lo = Math.max(startUt, bestUt - step);
  let hi = bestUt + step;
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let c = hi - (hi - lo) * invPhi;
  let d = lo + (hi - lo) * invPhi;
  let fc = separationAt(self, target, c);
  let fd = separationAt(self, target, d);
  for (let i = 0; i < GOLDEN_REFINE_ITERATIONS; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - (hi - lo) * invPhi;
      fc = separationAt(self, target, c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + (hi - lo) * invPhi;
      fd = separationAt(self, target, d);
    }
  }
  const ut = (lo + hi) / 2;
  const distance = separationAt(self, target, ut);
  if (!Number.isFinite(distance)) return null;
  return { ut, distance };
}

// ── state-vector → osculating elements (RV2COE) ─────────────────────────────

/**
 * Osculating orbital elements plus the flag distinguishing a bound ellipse
 * from an escape trajectory. `rvToElements` can produce either; the
 * anomaly-based consumers (`solve`, apsis maths) are only valid for
 * `bound === true`.
 */
export interface OsculatingElements extends OrbitElements {
  /** `true` for a bound ellipse (0 ≤ ecc < 1); `false` for a parabolic/hyperbolic escape trajectory. */
  bound: boolean;
}

/**
 * Convert a parent-body-relative state vector (position + velocity, metres /
 * m/s) at `epoch` into classical elements — the inverse of `kepler.solve`,
 * the standard RV2COE algorithm (Vallado). Angles come out in RADIANS to
 * match `OrbitElements`. Used by `previewManeuver` to read back the orbit a
 * burn produces. Round-trips `solve` to within numerical tolerance (see
 * `propagation.test.ts`).
 *
 * Reference direction for LAN is +Z; for a near-equatorial orbit (node
 * vector ~0) LAN is reported as 0 and `argPe` is measured from +X, mirroring
 * the "undefined node → 0" substitution `vessel-state.ts`'s `buildElements`
 * makes in the forward direction.
 */
export function rvToElements(
  position: Vector3,
  velocity: Vector3,
  mu: number,
  epoch: number,
): OsculatingElements {
  const r = magnitude(position);
  const v = magnitude(velocity);
  const hVec = cross(position, velocity);
  const h = magnitude(hVec);
  // Node vector = k × h (points toward the ascending node).
  const nVec = cross([0, 0, 1], hVec);
  const n = magnitude(nVec);

  // Eccentricity vector.
  const eVec = scale(
    sub(
      scale(position, v * v - mu / r),
      scale(velocity, dot(position, velocity)),
    ),
    1 / mu,
  );
  const ecc = magnitude(eVec);

  const energy = (v * v) / 2 - mu / r;
  // Bound ellipse iff specific orbital energy is negative.
  const bound = energy < 0 && ecc < 1;
  const sma = energy === 0 ? Number.POSITIVE_INFINITY : -mu / (2 * energy);

  const inc = h === 0 ? 0 : Math.acos(clamp(hVec[2] / h, -1, 1));

  let lan = 0;
  if (n > 1e-12) {
    lan = Math.acos(clamp(nVec[0] / n, -1, 1));
    if (nVec[1] < 0) lan = TWO_PI - lan;
  }

  let argPe = 0;
  if (n > 1e-12 && ecc > 1e-12) {
    argPe = Math.acos(clamp(dot(nVec, eVec) / (n * ecc), -1, 1));
    if (eVec[2] < 0) argPe = TWO_PI - argPe;
  } else if (ecc > 1e-12) {
    // Equatorial, eccentric: measure the periapsis longitude from +X.
    argPe = Math.acos(clamp(eVec[0] / ecc, -1, 1));
    if (eVec[1] < 0) argPe = TWO_PI - argPe;
  }

  // True anomaly at epoch → eccentric → mean, so the elements re-propagate.
  let trueAnomaly = 0;
  if (ecc > 1e-12) {
    trueAnomaly = Math.acos(clamp(dot(eVec, position) / (ecc * r), -1, 1));
    if (dot(position, velocity) < 0) trueAnomaly = TWO_PI - trueAnomaly;
  } else {
    // Circular: measure the argument of latitude from the ascending node (or
    // +X if equatorial). The sense comes from the orbital-plane orientation
    // (sign of (ref × r)·h), which is correct for both the equatorial case
    // (where position[2] is always 0 and can't disambiguate) and inclined.
    const ref = n > 1e-12 ? nVec : ([1, 0, 0] as Vector3);
    const refMag = magnitude(ref);
    trueAnomaly = Math.acos(clamp(dot(ref, position) / (refMag * r), -1, 1));
    if (dot(cross(ref, position), hVec) < 0) trueAnomaly = TWO_PI - trueAnomaly;
  }

  let meanAnomalyAtEpoch = 0;
  if (bound) {
    const eccAnomaly = Math.atan2(
      Math.sqrt(1 - ecc * ecc) * Math.sin(trueAnomaly),
      ecc + Math.cos(trueAnomaly),
    );
    meanAnomalyAtEpoch = wrapTwoPi(eccAnomaly - ecc * Math.sin(eccAnomaly));
  }

  return {
    sma,
    ecc,
    inc,
    lan,
    argPe,
    meanAnomalyAtEpoch,
    epoch,
    mu,
    bound,
  };
}

// ── maneuver-node post-burn preview ─────────────────────────────────────────

/** One maneuver node's ΔV in its own radial-out / normal / prograde frame. */
export interface ManeuverBurn {
  ut: number;
  dvRadial: number;
  dvNormal: number;
  dvPrograde: number;
}

/**
 * The orbit a burn produces — the consumer-side post-burn preview the
 * `VesselManeuver` contract doc ("derived, SDK-side, NOT streamed") calls
 * for, replacing Telemachus's arg-order-footgun `[x,y,z]` tuple + streamed
 * preview (old `o.maneuverNodes`).
 */
export interface ManeuverPreview {
  /** Post-burn osculating elements (radians), or `null` if the pre-burn orbit was degenerate. */
  elements: OsculatingElements | null;
  /** Periapsis radius from the body centre (metres): `sma·(1-ecc)`. */
  periapsisRadius: number | null;
  /** Apoapsis radius from the body centre (metres): `sma·(1+ecc)`. `null` for an escape trajectory (no apoapsis). */
  apoapsisRadius: number | null;
  /** Post-burn inclination, DEGREES. */
  inclinationDeg: number | null;
  /** `true` if the burn leaves a bound orbit; `false` for an escape trajectory. */
  bound: boolean;
}

/**
 * Apply a maneuver burn to a pre-burn orbit and read back the resulting
 * orbit. Propagates `elements` to the node UT for the state vector, adds the
 * ΔV in the node's radial-out/normal/prograde frame (the KSP maneuver-node
 * basis: `radial = normal × prograde`), then converts the post-burn state
 * vector back to elements via `rvToElements`. Returns a preview with the
 * apsis radii + inclination the map widgets render.
 */
export function previewManeuver(
  elements: OrbitElements,
  burn: ManeuverBurn,
): ManeuverPreview {
  const empty: ManeuverPreview = {
    elements: null,
    periapsisRadius: null,
    apoapsisRadius: null,
    inclinationDeg: null,
    bound: false,
  };
  if (elements.sma <= 0 || !Number.isFinite(elements.sma)) return empty;

  const state: StateVector = solve(elements, burn.ut);
  const prograde = normalize(state.velocity);
  const normal = normalize(cross(state.position, state.velocity));
  const radial = normalize(cross(normal, prograde));

  const dv = add(
    add(scale(radial, burn.dvRadial), scale(normal, burn.dvNormal)),
    scale(prograde, burn.dvPrograde),
  );
  const newVelocity = add(state.velocity, dv);

  const post = rvToElements(state.position, newVelocity, elements.mu, burn.ut);
  const periapsisRadius = Number.isFinite(post.sma)
    ? post.sma * (1 - post.ecc)
    : null;
  const apoapsisRadius =
    post.bound && Number.isFinite(post.sma) ? post.sma * (1 + post.ecc) : null;
  return {
    elements: post,
    periapsisRadius: finiteOrNull(periapsisRadius),
    apoapsisRadius:
      apoapsisRadius === null ? null : finiteOrNull(apoapsisRadius),
    inclinationDeg: finiteOrNull((post.inc * 180) / Math.PI),
    bound: post.bound,
  };
}

// ── patched-conic chain reconstruction ──────────────────────────────────────

/** A next-SOI transition boundary — the SDK mirror of `vessel.orbit.encounter`. */
export interface PatchEncounter {
  /** `Sitrep.Contract.TransitionType` ordinal. */
  transitionType: number;
  /** UT (seconds) of the transition. */
  transitionUt: number;
  /** `system.bodies` index of the body being transitioned into, or `null`. */
  bodyIndex: number | null;
}

/** One reconstructed conic segment of a trajectory. */
export interface OrbitPatch {
  /** `system.bodies` index this patch's elements are relative to. */
  referenceBodyIndex: number;
  /** UT the patch begins (seconds). */
  startUt: number;
  /** UT the patch ends — the encounter UT, or `startUt + period` for a full closed orbit; `null` if the period is undefined. */
  endUt: number | null;
  /** The conic's own elements. */
  elements: OrbitElements;
  /** Sampled parent-body-relative positions along the patch (for a polyline render). */
  points: Vector3[];
  /** The transition that terminates this patch, or `null` when the patch closes on itself (no encounter). */
  endTransition: PatchEncounter | null;
}

export interface BuildPatchesInput {
  elements: OrbitElements;
  referenceBodyIndex: number;
  /** The next SOI transition, or `null`/absent for a self-closing orbit. */
  encounter?: PatchEncounter | null;
}

export interface BuildPatchesOptions {
  /** Number of sampled points along each patch. Default 128. */
  samples?: number;
}

/**
 * Reconstruct the patched-conic chain client-side from streamed elements +
 * the next `encounter` — replacing the old `o.orbitPatches` capture (stream
 * elements + encounter, SDK reconstructs the chain; no mod capture of the
 * full chain).
 *
 * With only the CURRENT orbit's elements and the NEXT transition on the
 * wire, the honestly-reconstructable chain is a single conic segment: the
 * current orbit, sampled from `startUt` either to the encounter UT (an arc
 * terminated at the SOI boundary) or, with no encounter, over one full
 * period (a closed ellipse). The post-encounter conic's elements aren't on
 * the wire, so the chain does not fabricate a second patch — it carries the
 * transition as `endTransition` so a widget can annotate the boundary.
 */
export function buildOrbitPatches(
  input: BuildPatchesInput,
  startUt: number,
  options: BuildPatchesOptions = {},
): OrbitPatch[] {
  const { elements, referenceBodyIndex } = input;
  const encounter = input.encounter ?? null;
  const samples = Math.max(2, options.samples ?? 128);
  const period = orbitalPeriod(elements);

  const hasEncounter =
    encounter !== null &&
    Number.isFinite(encounter.transitionUt) &&
    encounter.transitionUt > startUt;

  const endUt = hasEncounter
    ? (encounter as PatchEncounter).transitionUt
    : period === null
      ? null
      : startUt + period;

  const points: Vector3[] = [];
  const span = endUt === null ? (period ?? 0) : endUt - startUt;
  for (let i = 0; i < samples; i++) {
    const ut = startUt + (span * i) / (samples - 1);
    points.push(solve(elements, ut).position);
  }

  return [
    {
      referenceBodyIndex,
      startUt,
      endUt,
      elements,
      points,
      endTransition: hasEncounter ? encounter : null,
    },
  ];
}

// ── internal ─────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function wrapTwoPi(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function finiteOrNull(x: number | null): number | null {
  return x !== null && Number.isFinite(x) ? x : null;
}
