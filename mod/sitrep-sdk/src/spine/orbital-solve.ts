import type { VesselOrbit } from "../__generated__/contract";
import { magnitudeOf, magnitudeOr, type Quantityish } from "../magnitude";
import type { ReckoningDecline } from "../reading";
import type { Value } from "../value";
import type { OrbitElements } from "./kepler";
import {
  buildElements,
  isHyperbolic,
  magnitude,
  trySolve,
  trySolveAnomalies,
  type WireOrbitElements,
} from "./kepler-reckoning";

/**
 * An orbit solved at one instant: its period, the vessel's anomaly, and the
 * apsides with the times to them, computed from the orbit's elements, the instant
 * asked about and the reference body's radius. Useful for showing the operator
 * where the vessel is on its orbit and when it next reaches each apsis. Used for
 * the vessel's orbit (`vessel.orbit`) and its target's (`vessel.target.orbit`)
 * alike, and read by the orbit view widget.
 *
 * Pass `undefined` for a body radius that cannot be resolved yet and `null` for a
 * confirmed absence, and the two altitude fields answer the same way. On an open
 * orbit (`ecc` of 1 or more) a field with no value is `null`, never a wrong
 * number: there is no period and no apoapsis, and no time to periapsis once the
 * vessel has passed it. The anomaly, the radius and the periapsis stay valid.
 */
export interface OrbitalSolve {
  /*
   * Why this is a function and not a hook
   *
   * The same mathematics is wanted for two orbits: the craft's
   * (`vessel.orbit`) and its target's (`vessel.target.orbit`, "the same
   * `VesselOrbit` shape as the self vessel, propagated to the same frozen
   * `viewUt`"). A solve bound to one topic needs a second copy of itself for the
   * other, and two copies of the arithmetic are two chances for the craft's
   * period and its target's to be computed differently.
   *
   * So the unit is `(orbit, viewUt, referenceBodyRadius)`. A hook that reads a
   * topic is a thin wrapper over this; it is never where the arithmetic lives.
   *
   * Why the body radius is a parameter rather than a lookup
   *
   * Two of these fields are altitudes, which is a radius minus the reference
   * body's. Resolving that means walking `trackingStation.bodies`, and the walk carries a
   * three-way discipline (absent vs not-yet-resolvable vs confirmed tombstone)
   * that belongs to the caller's channel, not to the mathematics. Taking the
   * resolved radius keeps this pure and still lets the discipline through: pass
   * `undefined` for "cannot resolve yet" and `null` for a confirmed absence, and
   * the two altitude fields answer the same way.
   *
   * Open orbits
   *
   * Every flyby and escape is one. The craft has a place on it, so the anomaly
   * and the radius are solved like any other. What an open orbit lacks needs a
   * check a finite guard cannot make: `2π/n` and `sma·(1+ecc)` are both finite
   * when `sma < 0`, just meaningless, so the period, the apoapsis and the time
   * to apoapsis are withheld by the shape and not by the arithmetic. Periapsis
   * stays valid, `sma·(1-ecc)` being a positive radius for both signs. A
   * parabolic orbit (`ecc` exactly 1) has no solve at all, and
   * `trySolve`/`trySolveAnomalies` answer `null` for it.
   */
  /** Seconds, `2π/n`. `null` on an open orbit, which has no period. */
  period: number | null;
  /** Degrees in `[0, 360)`, the widget-facing convention. */
  trueAnomaly: number | null;
  /** Seconds until the mean anomaly next reaches apoapsis. `null` on an open orbit. */
  timeToAp: number | null;
  /** Seconds until it next reaches periapsis. `null` on an open orbit once periapsis has passed. */
  timeToPe: number | null;
  /** `sma·(1+ecc)` from the body centre. `null` on a hyperbolic orbit, which has no apoapsis. */
  apoapsisRadius: number | null;
  /** `sma·(1-ecc)` from the body centre. */
  periapsisRadius: number | null;
  /** The solved position's distance from the body centre. */
  orbitalRadius: number | null;
  /** {@link apoapsisRadius} less the reference body's, i.e. an altitude. */
  apoapsisAlt: number | null | undefined;
  /** {@link periapsisRadius} less the reference body's. */
  periapsisAlt: number | null | undefined;
  /** `1` = apoapsis next, `-1` = periapsis next, `null` when neither countdown is available. */
  nextApsisType: number | null;
  /** Seconds to whichever {@link nextApsisType} names. */
  timeToNextApsis: number | null;
}

/**
 * A wire quantity's magnitude, or `NaN` when the field is absent.
 *
 * A Topic sends a subset of its fields routinely and the wrap leaves an absent
 * field absent, so NaN is what the arithmetic here produces for it anyway, and
 * every guard already accounts for it (`finiteOrNull`, `Number.isFinite`).
 * Threading `null` through the same expressions would buy nothing the guards do
 * not already do.
 *
 * NaN never leaves this module: every field it feeds goes through
 * `finiteOrNull` before it reaches an {@link OrbitalSolve}, because those fields
 * declare `number | null` and a consumer's `??` does not catch NaN.
 */
function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps a degree value into [0, 360), the KSP widget-facing angle convention (contrast `kepler.ts`'s internal [0, 2π) radian wrap). */
function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Seconds from `meanAnomaly` (radians) until the mean anomaly next reaches
 * `targetMeanAnomaly` (radians), wrapped forward to `[0, period)`, 0 when
 * already there. `null` for a non-finite or non-positive `meanMotion` (never
 * divide by zero/negative: a degenerate orbit has no well-defined period to
 * count down within).
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  targetMeanAnomaly: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(targetMeanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (targetMeanAnomaly - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/**
 * Seconds until an open orbit's one periapsis, where its mean anomaly is zero.
 * `null` once the craft has passed it, since there is no next one.
 */
function timeToOpenPeriapsis(
  meanAnomaly: number,
  meanMotion: number,
): number | null {
  if (!Number.isFinite(meanAnomaly) || !(meanMotion > 0)) return null;
  if (meanAnomaly > 0) return null;
  return finiteOrNull(Math.abs(meanAnomaly) / meanMotion);
}

/**
 * Which apsis comes next and the seconds until it: whichever of the two
 * countdowns is the smaller non-`null` value.
 *
 * Never a `0` or N/A sentinel. An unavailable next-apsis is `null`, which
 * the consuming chip treats identically, rendering only for a `±1` type with a
 * finite time.
 */
function nextApsis(
  timeToAp: number | null,
  timeToPe: number | null,
): { nextApsisType: number | null; timeToNextApsis: number | null } {
  if (timeToAp != null && (timeToPe == null || timeToAp <= timeToPe)) {
    return { nextApsisType: 1, timeToNextApsis: timeToAp };
  }
  if (timeToPe != null) {
    return { nextApsisType: -1, timeToNextApsis: timeToPe };
  }
  return { nextApsisType: null, timeToNextApsis: null };
}

/**
 * The apsides of a conic, which depend on its shape alone and not on where the
 * vessel is on it. Useful for showing the operator the highest and lowest points
 * of an orbit. Used by the orbit view widget. An open orbit
 * has no apoapsis. `referenceBodyRadius` follows {@link solveOrbit}'s rule, and
 * only the altitudes read it.
 */
export function conicApsides(
  orbit: Pick<WireOrbitElements, "sma" | "ecc">,
  referenceBodyRadius: number | null | undefined,
): Pick<
  OrbitalSolve,
  "apoapsisRadius" | "periapsisRadius" | "apoapsisAlt" | "periapsisAlt"
> {
  const hyperbolic = isHyperbolic(mag(orbit.ecc));
  const apoapsisRadius = hyperbolic
    ? null
    : finiteOrNull(mag(orbit.sma) * (1 + mag(orbit.ecc)));
  const periapsisRadius = finiteOrNull(mag(orbit.sma) * (1 - mag(orbit.ecc)));
  const altitude = (radius: number | null): number | null | undefined =>
    referenceBodyRadius == null
      ? referenceBodyRadius
      : radius == null
        ? null
        : finiteOrNull(radius - referenceBodyRadius);
  return {
    apoapsisRadius,
    periapsisRadius,
    apoapsisAlt: hyperbolic ? null : altitude(apoapsisRadius),
    periapsisAlt: altitude(periapsisRadius),
  };
}

/**
 * Solves `orbit` for `viewUt`, giving an {@link OrbitalSolve}. Useful for showing
 * the operator the vessel's or a target's position on its orbit at the instant on
 * screen. Used by the orbit hook, the maneuver planner and the maneuver trigger
 * services.
 *
 * `referenceBodyRadius` is the mean radius of the body the orbit is about,
 * already resolved by the caller: `undefined` where it cannot be resolved yet,
 * `null` where its channel is a confirmed tombstone. Only the two altitude fields
 * read it, and they answer with whichever of those they were given.
 */
export function solveOrbit(
  orbit: WireOrbitElements,
  viewUt: Value<"ut">,
  referenceBodyRadius: number | null | undefined,
): OrbitalSolve {
  return solveOrbitAt(orbit, mag(viewUt), referenceBodyRadius);
}

/** {@link solveOrbit} at an instant already in the plain seconds the reckoning's elements and trigonometry work in. */
function solveOrbitAt(
  orbit: WireOrbitElements,
  ut: number,
  referenceBodyRadius: number | null | undefined,
): OrbitalSolve {
  const elements: OrbitElements = buildElements(orbit);
  const solved = trySolve(elements, ut);
  const anomalies = trySolveAnomalies(elements, ut);

  const open = isHyperbolic(elements.ecc);
  const period =
    anomalies == null || open
      ? null
      : finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
  const trueAnomaly =
    anomalies == null
      ? null
      : finiteOrNull(wrapDegrees360(radToDeg(anomalies.trueAnomaly)));
  const timeToAp =
    anomalies == null || open
      ? null
      : timeToMeanAnomaly(anomalies.meanAnomaly, Math.PI, anomalies.meanMotion);
  const timeToPe =
    anomalies == null
      ? null
      : open
        ? timeToOpenPeriapsis(anomalies.meanAnomaly, anomalies.meanMotion)
        : timeToMeanAnomaly(anomalies.meanAnomaly, 0, anomalies.meanMotion);

  const orbitalRadius =
    solved?.position == null ? null : finiteOrNull(magnitude(solved.position));

  return {
    period,
    trueAnomaly,
    timeToAp,
    timeToPe,
    ...conicApsides(orbit, referenceBodyRadius),
    orbitalRadius,
    ...nextApsis(timeToAp, timeToPe),
  };
}

/**
 * The orbital elements {@link solveSelfOrbit} reads off a `VesselOrbit`, and
 * nothing else. Useful for passing a vessel's orbit sample to that function
 * without the rest of the payload.
 */
export type SelfOrbitElements = WireOrbitElements &
  Pick<VesselOrbit, "referenceBodyIndex"> & {
    timeToAp?: Quantityish;
    timeToPe?: Quantityish;
  };

/**
 * The active vessel's orbital solve at `viewUt`, or `null` where the caller is
 * not entitled to one. Useful for showing the operator the vessel's own orbit.
 * Used by the orbit hook and by plain-class callers, so both agree on when an
 * apoapsis exists.
 *
 * `elements` are whatever the caller's reading carries, `observed` or `held`.
 * `reckoning` is that reading's whole reckoning: where its model is available the
 * orbit is advanced to `viewUt`. `null` with no elements or no `viewUt`.
 *
 * Under physics the model declines to advance the orbit. A current reading, which
 * passes `observedAtUt` (the instant it was observed), is still answered in full:
 * the apsides, their altitudes and the period from the elements as they stand,
 * the vessel's anomaly and radius at the elements' own epoch, and the countdowns
 * from the sample's `timeToAp` and `timeToPe` less the time elapsed since
 * `observedAtUt` (see {@link countdownAt}). A sample that carries neither leaves
 * both, and the next apsis, `null`. A held reading answers `null` under physics.
 */
export function solveSelfOrbit(
  elements: SelfOrbitElements | undefined,
  reckoning:
    | { readonly status: "declined"; readonly declined: ReckoningDecline }
    | { readonly status: string },
  bodies: BodyRadiusTable | null | undefined,
  viewUt: Value<"ut"> | undefined,
  observedAtUt?: Value<"ut">,
): OrbitalSolve | null {
  /*
   * `elements` are whatever the caller's own reading is carrying, and `observed`
   * and `held` both carry them: `sma`, `ecc` and the rest are constants of the
   * orbit rather than figures that go out of date, so a model that moves the
   * phase makes the whole thing current again. That branch is written at each
   * read, where a reading has to be narrowed anyway.
   *
   * The model's refusal is the part that lives here, because a second copy of it
   * is how a hook and a plain class come to disagree about when an apoapsis
   * exists. `solveOrbit` advances a coast, and the reckoner is what knows
   * whether these elements describe one: it withdraws under physics, past an SOI
   * transition, below the atmosphere interface, past the reach the propagation
   * provider stated, and where no provider vouched for them being a conic at all.
   * The whole reckoning is taken rather than a boolean, so the condition is
   * written once in the place that documents it.
   *
   * `viewUt` is the instant asked about, the frame's SCET, and its absence is the
   * third `null`: with no frame there is nothing to solve for.
   *
   * Under physics, a current reading is answered in full
   *
   * The under-physics refusal is a refusal to advance: osculating elements are
   * not a coast a conic can carry to the view time. None of what is drawn needs
   * that. The apsides, their altitudes and the period are algebra on the elements
   * as they stand, and the craft's anomaly and radius at the elements' own epoch
   * are where it was when they were taken, so those are solved at that epoch.
   *
   * The countdowns are properties of that same instantaneous orbit, and KSP
   * computes them every frame whatever is pushing the craft. They come from the
   * sample's own `timeToAp` and `timeToPe`, less the time elapsed from
   * `observedAtUt` to `viewUt`; see `countdownAt`. A sample that carries
   * neither leaves both, and the next apsis, `null`.
   *
   * `observedAtUt` is present only for a current reading, and is when it was
   * observed. A held reading answers nothing under physics: under thrust the
   * elements are not constants of the orbit, so old ones say nothing about the
   * one the craft is on. That is where the refusal still bites.
   */
  if (elements === undefined || viewUt === undefined) return null;
  const radius = bodyRadiusOf(bodies, elements.referenceBodyIndex);
  if (reckoning.status === "available") {
    return solveOrbit(elements, viewUt, radius);
  }
  if (observedAtUt != null && declinedUnderPhysics(reckoning)) {
    const solve = solveOrbitAt(elements, mag(elements.epoch), radius);
    const elapsed = mag(viewUt.minus(observedAtUt));
    const hyperbolic = isHyperbolic(mag(elements.ecc));
    const timeToAp = hyperbolic
      ? null
      : countdownAt(mag(elements.timeToAp), elapsed, solve.period);
    const timeToPe = countdownAt(
      mag(elements.timeToPe),
      elapsed,
      hyperbolic ? null : solve.period,
    );
    return { ...solve, timeToAp, timeToPe, ...nextApsis(timeToAp, timeToPe) };
  }
  return null;
}

/**
 * A countdown observed `atSample` seconds out, as it stands `elapsed` seconds
 * later.
 *
 * Once the apsis has passed, a closed orbit (`period` finite and positive)
 * counts to the next one, the same wrap KSP applies to its own figure. An open
 * orbit has no next one, so a passed apsis is `null`, as is a missing sample
 * (`NaN`, which is what an absent wire field reads as).
 */
function countdownAt(
  atSample: number,
  elapsed: number,
  period: number | null,
): number | null {
  if (!Number.isFinite(atSample) || !Number.isFinite(elapsed)) return null;
  const remaining = atSample - elapsed;
  if (remaining >= 0) return remaining;
  if (period === null || !(period > 0)) return null;
  const wrapped = remaining % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

function declinedUnderPhysics(
  reckoning:
    | { readonly status: "declined"; readonly declined: ReckoningDecline }
    | { readonly status: string },
): boolean {
  return (
    reckoning.status === "declined" &&
    "declined" in reckoning &&
    reckoning.declined.reason === "under-physics"
  );
}

/**
 * The part of `trackingStation.bodies` an orbit solve needs: the stable-index body list
 * and nothing else. Useful for resolving the radius of the body an orbit is
 * about. Taken by {@link bodyRadiusOf}, and passed by the orbit hook and the
 * maneuver planner.
 *
 * `radius` is `Quantityish` because the same field has two shapes in this tree.
 * The store wraps every declared quantity on decode, so a topic read hands back a
 * `Value<"m">`; the client-side `SystemBodiesPayload` the derived channel is typed
 * against declares a plain `number`. `magnitudeOf` is the one place that decides
 * what an absent or non-finite magnitude means.
 */
export interface BodyRadiusTable {
  bodies: readonly { index: number; radius?: Quantityish }[];
}

/**
 * The mean radius of the body at `index`, with the three-way rule every
 * `trackingStation.bodies` lookup follows. Useful for converting an orbit's radius into an
 * altitude above the surface the operator knows. Used by the orbit hook, the
 * maneuver planner and the maneuver trigger services.
 *
 * - `undefined` where it cannot be resolved yet: no index to resolve, the channel
 *   has not arrived, or it has arrived and this body (or its radius specifically)
 *   is not in it. None of those is a confirmed absence
 * - `null` only when the channel itself is a confirmed tombstone
 *
 * Pure, and takes the payload rather than reading the topic, because the caller
 * is the only one that knows which of the two absences it is looking at. Indexed
 * by `SystemBodyPayload.index`, the stable id, never array position.
 */
export function bodyRadiusOf(
  bodies: BodyRadiusTable | null | undefined,
  index: number | null | undefined,
): number | null | undefined {
  if (index == null) return undefined;
  if (bodies === null) return null;
  if (bodies === undefined) return undefined;
  const found = bodies.bodies.find((b) => b.index === index);
  if (found === undefined) return undefined;
  return magnitudeOf(found.radius) ?? undefined;
}
