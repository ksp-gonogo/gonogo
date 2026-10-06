import { magnitudeOr, type Quantityish } from "../magnitude";
import {
  currentAtReckonTime,
  type ReckonerFrame,
  type ReckoningDecline,
  type UncertaintyBand,
} from "../reading";
import type { TimelinePoint } from "../timeline";
import { STANDARD_GRAVITY } from "../unit-system/definitions";
import { value } from "../unit-system/value";
import {
  atmosphereDepthOf,
  type ConicBodiesInput,
  entryInterfaceRadius,
} from "./kepler-reckoning";

/**
 * The other half of an altitude, for the regime the conic hands over to.
 *
 * `keplerAdmissibility` withdraws at the atmosphere interface, and it is right
 * to: below it a two-body coast is not a worse estimate but a different
 * trajectory. What that left was a hole exactly where an operator leans
 * hardest, because the descent a reckoned altitude is FOR happens entirely
 * inside the hole. So this module carries the value across the same gap on the
 * only evidence that survives an unknown aero model.
 *
 * ## It integrates the OBSERVED deceleration, and models no drag at all
 *
 * There is no drag model here, no ballistic coefficient and no capability probe
 * for FAR, and there must not be: the wire already carries the OUTCOME of
 * whatever aerodynamics are installed. `verticalSpeed` is a measurement, so its
 * rate of change over the last few seconds of contact IS the vertical
 * acceleration the craft actually experienced, gravity and drag and lift and
 * thrust included, in the exact frame `verticalSpeed` is expressed in. A model
 * that instead predicted drag would be a second opinion about a number the game
 * had already computed, and wrong under every aero mod.
 *
 * That is what `rate-integration` means here and why this is its first use: a
 * quantity advanced by its last observed rate of change, with the rate itself
 * taken from the record rather than from a companion field the contract would
 * have had to publish.
 *
 * `VesselFlight.AltitudeAsl` DECLARES this model, beside the conic and with its
 * own inputs (`verticalSpeed`, `gForce`, `@system.bodies`), which is what makes
 * it a promise to anyone holding the stream rather than a thing our client
 * happens to do. Every withdrawal below that blames an input therefore names it
 * in the contract's own spelling.
 *
 * ## Where the two models meet
 *
 * One named predicate, {@link withinAtmosphere}, asked over the SPAN the reading
 * covers rather than over one end of it. Inside the air this model owns the
 * frame and the conic is not asked; outside it the conic owns the frame and this
 * stands down.
 *
 * The span matters because the two ends are judged by different arithmetic. The
 * observation is an altitude and is compared against {@link atmosphereDepthOf};
 * the view time is a radius the conic has SOLVED for and is compared against
 * `entryInterfaceRadius`, which is the conic's own floor and not a second
 * reading of the same boundary. Asking only the observation is what left a band
 * `|verticalSpeed| x gap` wide in which the selector sent the frame to the conic
 * and the conic then withdrew on a floor the selector had never consulted, which
 * is every reentry at the moment the interface is crossed.
 *
 * Each branch then owns its OWN declines. That is the reason the selector is a
 * predicate rather than a fall-through from one model's refusal: a descent past
 * this model's horizon would otherwise be reported to the operator as the
 * conic's "the craft is under physics", which is true and is not the reason.
 *
 * There is deliberately no `meta.quality` condition, which is the conic's FIRST
 * withdrawal. A craft under physics is one the conic cannot advance and one this
 * model reads perfectly well, because an observed rate does not care how the
 * game is stepping the craft. The two withdraw on opposite facts, which is why
 * they cover two regimes rather than the same regime twice.
 */

/**
 * How far a descent integrated from its last observed rates stays honest, in
 * seconds, before `gForce` shortens it.
 *
 * Half `core-reckoners.ts`'s `LINEAR_HORIZON_SECONDS`, and for a reason rather
 * than for symmetry: a relative position carried by a relative velocity is only
 * bending under gravity, where a descent rate is being changed by a force that
 * GROWS with the air it is falling into. Fifteen is the round number inside
 * that, chosen rather than measured, and it is one constant here so that
 * widening it is a decision somebody takes rather than a number that drifts.
 *
 * It is a CEILING, not the horizon: see {@link horizonSecondsFor}.
 */
const ATMOS_HORIZON_SECONDS = 15;

/**
 * How far outside what the craft can be feeling a fitted slope may fall before
 * it stops being an acceleration at all.
 *
 * The envelope is a bound on the PHYSICS, so the slack absorbs the fit rather
 * than the aero: a least-squares slope over a handful of change-gated samples
 * has its own error, and a bound with no room in it would decline on that
 * instead of on the thing it is looking for.
 */
const SENSED_ENVELOPE_SLACK = 1.5;

/** Below two samples of the rate there is no rate. */
const MIN_HISTORY_SAMPLES = 2;

/**
 * How many roundings of the fit's own working magnitude the residuals must
 * clear before they count as the window disagreeing with the line.
 *
 * A perfect fit leaves residuals of zero in arithmetic and of a few ulps in a
 * double, and which one a descent lands on is decided by whether its numbers
 * happen to be representable in base two rather than by anything about the
 * craft. Samples walked back from an anchor at -5 m/s² land on the first; the
 * same walk at -5.2 lands on the second, about 2e-14 m/s against speeds of 250.
 * So the residuals are compared against the precision of the arithmetic that
 * produced them, and eight ulps is room for the handful of roundings between a
 * sample and its predicted value: the two means, the slope, and the product.
 *
 * It is a claim about the MACHINE and not a floor under how small an error may
 * be. Measured over 33768 perfectly-fitting windows, across UT epochs from 0 to
 * 9e7, accelerations from -0.5 to -25.5 m/s² and windows of three to eight
 * samples, the worst residue was 0.73 of these units and the faintest genuine
 * scatter still banded was 26 of them. The threshold sits in that gap rather
 * than against either edge of it.
 */
const FLOAT_RESIDUE_ULPS = 8;

/**
 * The fields of `vessel.flight` the atmospheric descent model reads. A
 * `vessel.flight` payload can be passed as it is. Every field is optional, as
 * a payload may carry only some of them; a missing one makes the model
 * decline.
 *
 * @category Reckoners
 */
export interface AtmosphericFlightInput {
  /** Height above sea level, metres. */
  altitudeAsl?: Quantityish;
  /** Vertical speed, m/s, negative when descending. */
  verticalSpeed?: Quantityish;
  /** The acceleration the craft feels apart from gravity, in multiples of standard gravity. */
  gForce?: Quantityish;
}

/**
 * A descent fitted by {@link atmosphericAdmissibility}: the craft's height and
 * vertical speed at the latest observation, its vertical acceleration measured
 * over recent samples, and how far forward the fit may be used. Evaluate it
 * with {@link atmosphericAltitudeAt}.
 *
 * @category Reckoners
 */
export interface AtmosphericDescentFit {
  /** UT of the observation everything here is anchored on. */
  readonly anchorUt: number;
  /** Metres above sea level at {@link anchorUt}. */
  readonly altitudeAsl: number;
  /** Metres per second at {@link anchorUt}, signed: negative is descending. */
  readonly verticalSpeed: number;
  /** The vertical acceleration measured over the recent samples, m/s², gravity included. */
  readonly verticalAcceleration: number;
  /**
   * The standard error of `verticalAcceleration`, m/s², or `undefined` when
   * the samples give no measure of it. See {@link SlopeFit.stdError}.
   */
  readonly accelerationStdError: number | undefined;
  /** How far past {@link anchorUt} this fit may be asked, in seconds. */
  readonly horizonSeconds: number;
  /** How many usable samples of the rate the window held. */
  readonly samples: number;
}

/**
 * Returns how many seconds a descent fit may be carried forward, given the
 * sensed `gForce` in g: the harder the craft is being decelerated, the
 * shorter. At about 1 g (on the pad, under a parachute, in level flight) it is
 * longest; at the 5 to 10 g of peak entry, seconds.
 *
 * @category Reckoners
 */
export function horizonSecondsFor(gForce: number): number {
  return ATMOS_HORIZON_SECONDS / Math.max(1, gForce);
}

/**
 * The window of `vessel.flight` samples the descent fit is taken over: the last
 * 8 seconds, at most 8 samples. The Topic only gets a sample when its value
 * changes, so the window may hold anywhere from one sample to eight.
 *
 * It has no `minSamples`, since `vessel.flight`'s orbit model needs only one
 * sample; {@link atmosphericAdmissibility} requires two for the descent fit
 * itself.
 *
 * @category Reckoners
 */
export const DESCENT_WINDOW = { spanUt: 8, maxSamples: 8 } as const;

/**
 * Returns whether the craft is inside the parent body's atmosphere at either
 * the latest observation or the view time: the test that chooses between the
 * two models of `vessel.flight`'s altitude. `true` hands the frame to the
 * atmospheric descent model, `false` to the orbit model.
 *
 * `altitudeAsl` is the observed height. `conicRadiusAtViewTime` is the
 * distance from the body's centre the orbit model gives at the view time; when
 * it is absent, the observation decides alone. Returns `false` when the body
 * has no atmosphere or nothing says how deep it is.
 *
 * @category Reckoners
 */
export function withinAtmosphere(
  bodies: ConicBodiesInput | undefined,
  referenceBodyIndex: number | null | undefined,
  altitudeAsl: Quantityish,
  conicRadiusAtViewTime?: number,
): boolean {
  const depth = atmosphereDepthOf(bodies, referenceBodyIndex);
  if (depth === undefined) return false;
  const observed = magnitudeOr(altitudeAsl, Number.NaN);
  if (Number.isFinite(observed) && observed < depth) return true;
  const floor = entryInterfaceRadius(bodies, referenceBodyIndex);
  return (
    floor !== undefined &&
    conicRadiusAtViewTime !== undefined &&
    Number.isFinite(conicRadiusAtViewTime) &&
    conicRadiusAtViewTime <= floor
  );
}

/**
 * A least-squares slope over unevenly spaced samples, as
 * {@link verticalAccelerationOver} returns it.
 *
 * @category Reckoners
 */
export interface SlopeFit {
  /** How many samples were fitted. */
  readonly samples: number;
  /** `undefined` when every sample carries the same instant. */
  readonly slope: number | undefined;
  /**
   * The standard error of `slope`, in the slope's units, or `undefined` when
   * the samples give no measure of it: with only two samples, when all samples
   * share one instant, or when every sample lies on the line to within
   * rounding. None of those means the slope is known exactly.
   */
  readonly stdError: number | undefined;
}

/**
 * Returns the vertical acceleration over a window of `vessel.flight` samples:
 * a least-squares slope of `verticalSpeed` against time, so uneven spacing is
 * accounted for. It is an average over the window, not the acceleration at its
 * end. Samples from any craft other than `subject` are ignored.
 *
 * @category Reckoners
 */
export function verticalAccelerationOver(
  history: readonly TimelinePoint<AtmosphericFlightInput>[],
  subject: string,
): SlopeFit {
  const samples: { t: number; v: number }[] = [];
  for (const p of history) {
    if (p.meta.source !== subject) continue;
    const v = magnitudeOr(p.payload?.verticalSpeed, Number.NaN);
    if (Number.isFinite(p.validAt) && Number.isFinite(v)) {
      samples.push({ t: p.validAt, v });
    }
  }
  if (samples.length < MIN_HISTORY_SAMPLES) {
    return { samples: samples.length, slope: undefined, stdError: undefined };
  }
  const n = samples.length;
  let tBar = 0;
  let vBar = 0;
  for (const s of samples) {
    tBar += s.t / n;
    vBar += s.v / n;
  }
  let covariance = 0;
  let spread = 0;
  for (const s of samples) {
    const dt = s.t - tBar;
    covariance += dt * (s.v - vBar);
    spread += dt * dt;
  }
  if (!(spread > 0)) {
    return { samples: n, slope: undefined, stdError: undefined };
  }
  const slope = covariance / spread;
  /*
   * The ordinary least-squares standard error of a slope: the residual variance
   * over the spread the slope was taken across. `n - 2` degrees of freedom
   * because the line spent two of them, on its own slope and intercept.
   *
   * A second pass over the samples rather than a running sum of squares, which
   * is the numerically stable spelling and costs nothing on a window capped at
   * eight points.
   */
  const dof = n - 2;
  if (dof < 1) return { samples: n, slope, stdError: undefined };
  let residuals = 0;
  let speedScale = 0;
  let timeScale = 0;
  for (const s of samples) {
    const predicted = vBar + slope * (s.t - tBar);
    residuals += (s.v - predicted) ** 2;
    speedScale = Math.max(speedScale, Math.abs(s.v));
    timeScale = Math.max(timeScale, Math.abs(s.t));
  }
  /*
   * The residuals against the precision they were computed at, rather than
   * against zero: see {@link FLOAT_RESIDUE_ULPS}. An RMS is what the comparison
   * needs because a rounding is a bound on ONE residual, where the sum of
   * squares grows with the sample count.
   *
   * The scale carries the TIME term as well as the speed, because a residual is
   * `v - (vBar + slope * (t - tBar))` and `tBar` is a mean of INSTANTS: its own
   * rounding is a fraction of an ulp of UT, which the slope then multiplies up
   * into the speeds. UT reaches tens of millions of seconds in a long campaign
   * where a descent rate is hundreds, so `|slope| * timeScale` is the larger of
   * the two wherever the window does not sit near UT zero. A bound on the speeds
   * alone is not a bound on this: it misses a perfectly-fitting window by up to
   * five orders of magnitude, and misses every frame of the committed handover
   * set, whose instants are UT ~1000 against speeds of ~700.
   */
  const residualRms = Math.sqrt(residuals / dof);
  const fitScale = speedScale + Math.abs(slope) * timeScale;
  if (residualRms <= FLOAT_RESIDUE_ULPS * Number.EPSILON * fitScale) {
    return { samples: n, slope, stdError: undefined };
  }
  const stdError = Math.sqrt(residuals / dof / spread);
  return {
    samples: n,
    slope,
    stdError: Number.isFinite(stdError) ? stdError : undefined,
  };
}

/**
 * Returns a {@link AtmosphericDescentFit} for carrying the craft's altitude
 * forward through the atmosphere, or a decline saying why not. It declines,
 * in this order, when:
 *
 * - the observation is live, so there is nothing to carry forward
 * - the observation has no altitude
 * - the craft is not in the atmosphere (see {@link withinAtmosphere})
 * - the observation has no vertical speed, or no g-force
 * - the view time is past {@link horizonSecondsFor}
 * - fewer than two samples from this craft are in the window
 *   (`"insufficient-history"`)
 * - the measured acceleration is more than gravity plus the sensed g-force
 *   allow, as across a change of regime, a rewind or a scene change
 *
 * `gravity` is the local gravity in m/s², from {@link localGravity}. When it is
 * `undefined` the last check is skipped.
 *
 * @category Reckoners
 */
export function atmosphericAdmissibility(
  point: TimelinePoint<AtmosphericFlightInput>,
  history: readonly TimelinePoint<AtmosphericFlightInput>[],
  bodies: ConicBodiesInput | undefined,
  referenceBodyIndex: number | null | undefined,
  gravity: number | undefined,
  frame: ReckonerFrame,
  conicRadiusAtViewTime?: number,
): AtmosphericDescentFit | { readonly declined: ReckoningDecline } {
  if (currentAtReckonTime(frame)) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "the observation is current, so there is no gap to carry it across",
      },
    };
  }
  const altitudeAsl = magnitudeOr(point.payload?.altitudeAsl, Number.NaN);
  if (!Number.isFinite(altitudeAsl)) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no altitude was observed, so there is nothing to advance",
      },
    };
  }
  if (
    !withinAtmosphere(
      bodies,
      referenceBodyIndex,
      altitudeAsl,
      conicRadiusAtViewTime,
    )
  ) {
    return {
      declined: {
        reason: "model-inapplicable",
        input: "@system.bodies",
        note: "not inside the parent body's atmosphere, where the conic carries the altitude instead",
      },
    };
  }
  const verticalSpeed = magnitudeOr(point.payload?.verticalSpeed, Number.NaN);
  if (!Number.isFinite(verticalSpeed)) {
    return {
      declined: {
        reason: "input-absent",
        input: "verticalSpeed",
        note: "it is the rate this model integrates, and no value for it was observed",
      },
    };
  }
  const sensed = magnitudeOr(point.payload?.gForce, Number.NaN);
  if (!Number.isFinite(sensed)) {
    return {
      declined: {
        reason: "input-absent",
        input: "gForce",
        note: "the sensed deceleration is what bounds how far a descent rate may be carried, so without it there is no horizon to stay inside",
      },
    };
  }
  const horizonSeconds = horizonSecondsFor(sensed);
  const dt = frame.reckonUt - point.validAt;
  if (!Number.isFinite(dt)) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "the view time is not a number",
      },
    };
  }
  if (dt > horizonSeconds) {
    return {
      declined: {
        reason: "beyond-horizon",
        input: "gForce",
        note: `cannot model more than ${horizonSeconds.toFixed(1)} seconds past the last observation`,
      },
    };
  }
  const fit = verticalAccelerationOver(history, point.meta.source);
  if (fit.slope === undefined) {
    return {
      declined:
        fit.samples < MIN_HISTORY_SAMPLES
          ? {
              reason: "insufficient-history",
              note: `the model needs ${MIN_HISTORY_SAMPLES} samples of this craft's descent rate and the window holds ${fit.samples}`,
            }
          : {
              reason: "model-inapplicable",
              note: "every sample in the window carries the same instant, so there is no interval to take a rate over",
            },
    };
  }
  if (gravity !== undefined) {
    const envelope =
      (gravity + sensed * STANDARD_GRAVITY) * SENSED_ENVELOPE_SLACK;
    if (Math.abs(fit.slope) > envelope) {
      return {
        declined: {
          reason: "model-inapplicable",
          input: "gForce",
          note: "the descent rate changed across the window by more than gravity and the sensed deceleration allow, so the window spans a change of regime rather than a trend",
        },
      };
    }
  }
  return {
    anchorUt: point.validAt,
    altitudeAsl,
    verticalSpeed,
    verticalAcceleration: fit.slope,
    accelerationStdError: fit.stdError,
    horizonSeconds,
    samples: fit.samples,
  };
}

/**
 * Returns the fit's altitude above sea level at the UT `at`, in metres,
 * carried forward with constant acceleration from the latest observation.
 *
 * @category Reckoners
 */
export function atmosphericAltitudeAt(
  fit: AtmosphericDescentFit,
  at: number,
): number {
  const dt = at - fit.anchorUt;
  return (
    fit.altitudeAsl +
    fit.verticalSpeed * dt +
    0.5 * fit.verticalAcceleration * dt * dt
  );
}

/**
 * Returns how well the fit knows its altitude at the UT `at`, as a band of
 * kind `sigma1`, or `undefined` when the fit has no measure of its error. The
 * band comes from the uncertainty of the measured acceleration alone, so it is
 * zero at the observation and widens with the square of the time since.
 *
 * @category Reckoners
 */
export function atmosphericAltitudeBandAt(
  fit: AtmosphericDescentFit,
  at: number,
): UncertaintyBand<"m"> | undefined {
  const sigma = fit.accelerationStdError;
  if (sigma === undefined) return undefined;
  const dt = at - fit.anchorUt;
  const halfWidth = 0.5 * sigma * dt * dt;
  if (!Number.isFinite(halfWidth)) return undefined;
  const altitude = atmosphericAltitudeAt(fit, at);
  return {
    value: value("m", altitude),
    lo: value("m", altitude - halfWidth),
    hi: value("m", altitude + halfWidth),
    kind: "sigma1",
  };
}

/**
 * Returns gravity at a distance `radius` in metres from the body's centre,
 * in m/s², from the body's gravitational parameter `mu`, or `undefined` when
 * either is missing or not usable.
 *
 * @category Reckoners
 */
export function localGravity(
  mu: Quantityish,
  radius: number,
): number | undefined {
  const gm = magnitudeOr(mu, Number.NaN);
  if (!Number.isFinite(gm) || !Number.isFinite(radius) || radius <= 0) {
    return undefined;
  }
  return gm / (radius * radius);
}
