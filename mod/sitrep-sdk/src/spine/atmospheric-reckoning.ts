import { magnitudeOr, type Quantityish } from "../magnitude";
import type { ReckoningDecline, StaleGrade } from "../reading";
import type { TimelinePoint } from "../timeline";
import { STANDARD_GRAVITY } from "../unit-system/definitions";
import { atmosphereDepthOf, type ConicBodiesInput } from "./kepler-reckoning";

/**
 * The other half of an altitude, for the regime the conic hands over to.
 *
 * `keplerAdmissibility` withdraws at the atmosphere interface, and it is right
 * to: below it a two-body coast is not a degraded answer but a different
 * trajectory. What that left was a hole exactly where an operator leans hardest,
 * because the descent a reckoned altitude is FOR happens entirely inside the
 * hole. So this module carries the value across the same gap on the only
 * evidence that survives an unknown aero model.
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
 * One named predicate over one published fact: {@link withinAtmosphere}, over
 * {@link atmosphereDepthOf}. Inside the air this model owns the frame and the
 * conic is not asked; outside it the conic owns the frame and this stands down.
 * `altitudeAsl` is `radius - seaLevel` by definition, so comparing the observed
 * altitude against the depth is the same line `entryInterfaceRadius` draws
 * against a solved radius, and the handover is an instant rather than an overlap
 * or a gap.
 *
 * Each branch then owns its OWN declines. That is the reason the selector is a
 * predicate rather than a fall-through from one model's refusal: a descent past
 * this model's horizon would otherwise be reported to the operator as the
 * conic's "the craft is under physics", which is true and is not the answer.
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
 * The slice of `vessel.flight` this model reads.
 *
 * Declared structurally for the same reason `ConicOrbitInput` is: every field is
 * one `VesselFlight` already publishes, so a payload passes without a cast, and
 * the module stays below the channel record built on top of it. Every field is
 * OPTIONAL because the wire's is: a partial frame carries some of them, and
 * `magnitudeOr` plus a finiteness check is what turns an absence into a decline
 * rather than into arithmetic on nothing.
 */
export interface AtmosphericFlightInput {
  altitudeAsl?: Quantityish;
  verticalSpeed?: Quantityish;
  /** Multiples of standard gravity: the SENSED, non-gravitational acceleration. */
  gForce?: Quantityish;
}

/**
 * A fitted descent: the anchor's state, the rate of change of that rate taken
 * from the record, and how far the pair may be carried.
 *
 * Held as data rather than as a closure because both halves are worth reporting:
 * a test asserts the fitted acceleration directly, and a decline can say what
 * the horizon was without re-deriving it.
 */
export interface AtmosphericDescentFit {
  /** UT of the observation everything here is anchored on. */
  readonly anchorUt: number;
  /** Metres above sea level at {@link anchorUt}. */
  readonly altitudeAsl: number;
  /** Metres per second at {@link anchorUt}, signed: negative is descending. */
  readonly verticalSpeed: number;
  /**
   * Metres per second squared, from the window. The TOTAL vertical
   * acceleration, gravity included, because that is what a measured rate of
   * change of a measured rate is.
   */
  readonly verticalAcceleration: number;
  /** How far past {@link anchorUt} this fit may be asked, in seconds. */
  readonly horizonSeconds: number;
  /** How many usable samples of the rate the window held. */
  readonly samples: number;
}

/**
 * How long a mean rate stays true, given how violent the regime is.
 *
 * `gForce` is the only published read on that violence, and it is a good one:
 * it sits at about 1 in every steady state a craft can be in (on the pad, at
 * terminal velocity under a chute, in level flight) and rises with the force
 * being applied, so peak entry deceleration reads 5 to 10 and closes the
 * horizon to seconds. Dividing rather than subtracting keeps the ceiling
 * meaningful at the top of the atmosphere, where drag has not yet bitten and a
 * measured acceleration is very nearly just gravity.
 *
 * **`gForce` is used as a MAGNITUDE and nothing here needs its direction.** The
 * wire publishes `Vessel.geeForce`, a scalar, so a direction could only come
 * from the velocity vector: the flight-path angle `verticalSpeed / surfaceSpeed`
 * under the assumption that the sensed force acts along the velocity, which lift
 * and thrust both break and which FAR breaks hardest on the bodies most worth
 * modelling. This model never makes that assumption, because the window's own
 * slope already carries the vertical component with its sign. Both uses of
 * `gForce` here (this, and the envelope in {@link atmosphericAdmissibility}) are
 * bounds on a magnitude, and sound whatever the aerodynamics did.
 *
 * It takes a NUMBER, so an absent `gForce` cannot reach it. Defaulting the
 * divisor to 1 here would read "no evidence of violence" as "evidence of calm",
 * which is the absence-substitution that hides a missing field: the ceiling would
 * silently open back up to its widest on exactly the frames where nothing is
 * known about the regime. `gForce` is a DECLARED input of the mark instead, and
 * {@link atmosphericAdmissibility} declines naming it.
 */
export function horizonSecondsFor(gForce: number): number {
  return ATMOS_HORIZON_SECONDS / Math.max(1, gForce);
}

/**
 * How much of `vessel.flight`'s own record the descent fit is taken over.
 *
 * A COST CAP and a lookback, never a sample count: the stream is change-gated,
 * so eight seconds of a plummeting capsule holds many points and eight seconds
 * of a craft parked on the pad holds one, and nothing here divides the span by
 * an interval to guess which.
 *
 * Eight seconds because the fitted slope is a MEAN over the lookback and the
 * regime it is fitting changes under it, so a longer window buys more samples
 * at the cost of describing the wrong instant. Eight samples because a
 * least-squares slope is not improved by the ninth, and the store keeps both
 * ends when it thins, so the baseline survives the cap.
 *
 * **No `minSamples`, deliberately.** The store settles that floor for the whole
 * TOPIC before any model runs, and `vessel.flight`'s other model is a conic that
 * needs exactly one point: declaring a floor of two here would refuse the conic
 * on every frame where the record was short. The floor is asserted inside
 * {@link atmosphericAdmissibility} instead, which returns the same
 * `insufficient-history` shape the store would have.
 */
export const DESCENT_WINDOW = { spanUt: 8, maxSamples: 8 } as const;

/**
 * Whether the last observation puts the craft inside the parent body's air.
 *
 * THE HANDOVER, as one named predicate, so the two models of one altitude are
 * selected by a single test rather than by each guessing at the other's reach.
 * `true` and the rate integration owns the frame; `false` and the conic does.
 * There is no third answer and no band where both apply, which is the property
 * that could not be had while each branch drew its own boundary.
 *
 * `false` when nothing published resolves, and that is the honest default rather
 * than a coin toss: with no atmosphere depth there is no interface to be inside
 * of, and with no observed altitude there is nothing for a rate integration to
 * advance, while a conic needs neither.
 */
export function withinAtmosphere(
  bodies: ConicBodiesInput | undefined,
  referenceBodyIndex: number | null | undefined,
  altitudeAsl: Quantityish,
): boolean {
  const depth = atmosphereDepthOf(bodies, referenceBodyIndex);
  if (depth === undefined) return false;
  const observed = magnitudeOr(altitudeAsl, Number.NaN);
  return Number.isFinite(observed) && observed < depth;
}

/** A least-squares slope over irregularly spaced samples, and how many there were. */
export interface SlopeFit {
  readonly samples: number;
  /** `undefined` when every sample carries the same instant. */
  readonly slope: number | undefined;
}

/**
 * The rate of change of the observed `verticalSpeed` across the window.
 *
 * **Least squares, because the samples are NOT evenly spaced.** The stream is
 * change-gated: a topic carries a point when its value actually changed, so
 * "changes every second" and "is sampled every second" are the same shape in
 * the buffer and different facts about the world. A difference of consecutive
 * samples divided by a nominal interval would be wrong by whatever the real
 * spacing was, and the store's own thinning (`maxSamples` keeps the ends and
 * spreads the rest by INDEX) widens the gaps in the middle on purpose. A fit
 * over `(validAt, verticalSpeed)` pairs takes the spacing from the pairs.
 *
 * The slope is therefore a MEAN over the lookback rather than the acceleration
 * at the anchor instant, which is the reason the window is short and the reason
 * the horizon shortens further as the regime gets violent. A window that
 * straddles a change of regime is what {@link atmosphericAdmissibility}'s
 * envelope is looking for.
 *
 * The window never spans a break in the record, so there is no gap to detect
 * here: the store truncates at a `gapSinceUt` claim or a tombstone before this
 * sees it, and what arrives is a contiguous run or too little of one.
 *
 * It can still span a change of SUBJECT, which the store does not cut at, so
 * `subject` is required and every sample from another craft is dropped. Two
 * vessels' descent rates are not one craft's trend, and a switch between them
 * is a step the fit would read as an enormous acceleration. Whatever survives
 * the filter meets the same floor as any other short window, so this needs no
 * rejection of its own.
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
    return { samples: samples.length, slope: undefined };
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
  if (!(spread > 0)) return { samples: n, slope: undefined };
  return { samples: n, slope: covariance / spread };
}

/**
 * Whether this frame's altitude may be carried forward by its observed rates,
 * and the fit to carry it with.
 *
 * The counterpart of `keplerAdmissibility`, and the withdrawal conditions are
 * ordered the way that function orders its own: cheapest and most informative
 * first, so an operator hears about the thing that is actually missing rather
 * than about the last check to fail.
 *
 * - **the observation is current.** A rate integration starts FROM the last
 *   observation, so on a live reading it has nothing to add and would replace a
 *   measured altitude with arithmetic about the same instant. `ReckonerFor`'s
 *   own doc names this case, and `core-reckoners.ts`'s `elapsedOrDecline` takes
 *   the identical posture for the dead-reckoned pair. A conic, being a CAUSE
 *   rather than an integration, correctly does not
 * - **nothing to advance.** No observed altitude at the anchor, so there is no
 *   value for a rate to be applied to
 * - **there is no air here.** {@link withinAtmosphere} says the observation is
 *   outside the parent body's atmosphere, or that nothing published says
 *   otherwise, and the conic owns the regime. This is the handover, and it is one
 *   comparison against one number. A caller that already branched on the same
 *   predicate cannot reach it, and it is here so that a direct caller does
 * - **no rate to advance it by.** The anchor's `verticalSpeed`, which is the
 *   quantity this model integrates
 * - **nothing to bound it with.** The anchor's `gForce`. Both of these are
 *   DECLARED inputs of the mark, so the decline names them the way the contract
 *   spells them
 * - **past the horizon.** {@link horizonSecondsFor}, which the sensed `gForce`
 *   closes as the regime gets violent. Declining is the point of it; a confident
 *   altitude ten seconds into a peak-deceleration entry is exactly the failure a
 *   `Reading` exists to withhold
 * - **too little of the record.** Fewer than two usable samples of the rate FROM
 *   THIS CRAFT,
 *   answered in the store's own `insufficient-history` shape. The note below
 *   says why that floor is asserted here rather than declared as
 *   `window.minSamples`
 * - **the fitted slope is not an acceleration.** The envelope: whatever the
 *   craft is feeling, its total vertical acceleration cannot exceed local
 *   gravity plus the sensed non-gravitational magnitude. A slope outside that is
 *   a window straddling a change of regime, a rewind, or a scene change, and the
 *   honest answer is that this is not a trend
 *
 * ## The window's floor is asserted HERE rather than declared
 *
 * `ReckonerWindow.minSamples` would be the natural home for "two samples or
 * nothing", and it cannot be used: the store settles it for the whole TOPIC
 * before `reckon` runs, and `vessel.flight`'s other model is a conic that needs
 * exactly one point. Declaring the floor would refuse the conic on every frame
 * where the record was short. So the branch asserts its own floor and returns
 * the same `insufficient-history` shape the store would have.
 *
 * The note says how many samples were found and does NOT say why there were not
 * more. Only the store can tell "the record is short" from "the rest of the
 * window is on the far side of a blackout", and it does not pass that on.
 *
 * `gravity` is the local `mu / r²`, or `undefined` where the roster or the
 * elements did not carry enough to compute it. Absent, the envelope is not
 * checked: a withdrawal is asserted on evidence, never on the lack of it.
 */
export function atmosphericAdmissibility(
  point: TimelinePoint<AtmosphericFlightInput>,
  history: readonly TimelinePoint<AtmosphericFlightInput>[],
  bodies: ConicBodiesInput | undefined,
  referenceBodyIndex: number | null | undefined,
  gravity: number | undefined,
  grade: StaleGrade | undefined,
  viewUt: number,
): AtmosphericDescentFit | { readonly declined: ReckoningDecline } {
  if (grade === undefined) {
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
  if (!withinAtmosphere(bodies, referenceBodyIndex, altitudeAsl)) {
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
  const dt = viewUt - point.validAt;
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
        note: `a descent integrated from its last observed rates is honest for about ${horizonSeconds.toFixed(1)} seconds at the sensed deceleration, and this is further`,
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
    horizonSeconds,
    samples: fit.samples,
  };
}

/**
 * The fit, evaluated at `at`: one constant-acceleration step, which is the whole
 * of `rate-integration` for a descent.
 *
 * Second order rather than first because the first derivative of an altitude in
 * air is the thing being changed: a capsule at the interface and the same
 * capsule a few seconds later are hundreds of metres per second apart, so
 * carrying the altitude by its vertical speed alone would be a straight line
 * through the only part of the descent that is not one. Third order is not
 * available and would not help, because the jerk would have to come from the
 * same short window the acceleration came from.
 *
 * Pure, and asked per instant, so a plotted tail re-asking at every step gets
 * one curve rather than a chain of re-anchored guesses.
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
 * Local gravitational acceleration, or `undefined` when the inputs for it did
 * not arrive.
 *
 * `mu` off `@vessel.orbit` and the radius off `@system.bodies`. Only the second
 * is an input of the rate-integration MARK; `mu` is deliberately not, because
 * the envelope it feeds is a refinement the model runs WITHOUT rather than a
 * thing it needs, and a declared input a model can do without costs the marked
 * value's siblings for nothing. It reaches this function as a registered
 * reckoner's dep, which the conic on the same topic already declares.
 *
 * A magnitude, with no sign convention to get wrong: the one place that uses it
 * compares magnitudes.
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
