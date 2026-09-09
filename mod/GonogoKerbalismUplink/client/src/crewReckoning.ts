import type {
  ModelledField,
  ReckonedBands,
  ReckonerFrame,
  ReckonerWindow,
  TimelinePoint,
  TopicPayload,
  UncertaintyBand,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import { KERBALISM_CREW_TOPIC } from "./topics";
import { KERBALISM } from "./uplink";

/**
 * A kerbal's survival accumulators, carried forward at the rate they are
 * OBSERVED to be moving.
 *
 * ## Why not the rate the profile declares
 *
 * `KerbalismCrewRule` publishes the accumulator and a rate side by side, which
 * is the shape a rate integration wants, and taking the published rate would
 * be wrong. `degenPerSec` is a CONFIGURATION CONSTANT off
 * `Profile.rules[].degeneration`, and `KerbalismCrewEntry.deathClockUt`'s own
 * doc states the condition it omits: "a rule only degenerates once its input
 * resource is gone". So the declared rate is what the rule WOULD do while
 * starved, not what it is doing, and a model integrating it would advance a
 * perfectly supplied kerbal towards their fatal threshold on schedule. That is
 * a modelled rate presented as an observation, which is the failure the whole
 * reckoning type exists to prevent.
 *
 * The declared window is what makes the honest version possible. Two samples of
 * `value` ARE the rate that is happening, whatever the profile says, and a flat
 * pair is positive evidence that the rule is not degenerating: the input
 * resource is still aboard. `minSamples: 2` is therefore load-bearing rather
 * than decoration, and the store raises `insufficient-history` on this model's
 * behalf below it, because a slope taken from one point is not a slope.
 *
 * ## Fitted over `(stamp, value)` pairs, and the stamp is not the wire time
 *
 * The x-axis is each entry's own `asOfUt`, the UT Kerbalism last ADVANCED the
 * accumulators, not the sample's `validAt`. Unloaded craft take their Kerbalism
 * turn one per physics tick in rotation, so two consecutive wire points can
 * carry the same `asOfUt` (the craft did not take a turn between them) and the
 * accumulator is genuinely unchanged across a real interval of wire time.
 * Fitting against `validAt` would read that as a slope of zero over a gap the
 * game never simulated.
 *
 * Which also means the pairs can collapse onto ONE instant, and a slope over no
 * time is not a slope: see {@link observedSlope}.
 *
 * ## What it does not touch
 *
 * `deathClockUt` is an absolute instant the mod derived from the reading at
 * `asOfUt`, and its contract is explicit that "It is NOT restamped to now:
 * nothing is advanced, the instant is exactly the one the stamped-at reading
 * implied". Carrying it forward would move a deadline nobody moved. Every
 * sibling here (the name, the trait, the declared rate, the threshold, the
 * deadline) travels verbatim, and `modelled` names only the accumulators.
 */

/**
 * How far a degenerating accumulator stays honest, in seconds.
 *
 * Chosen rather than measured. The observed slope says the rule is starved
 * RIGHT NOW, and what ends that is the input resource coming back: a converter
 * catching up, a craft docking, a crew transfer. None of those is predictable
 * from this channel, so the horizon is a statement about how long "still
 * starved" is a safe assumption rather than a property of the arithmetic.
 *
 * Ten minutes is the round number inside that. The clamp at
 * `fatalThreshold` is the other limiter and the sharper one: past the threshold
 * the kerbal is dead and every rate here is about someone who no longer has
 * one, so the model stops rather than carrying the accumulator up into a range
 * that describes nobody.
 */
export const CREW_DEGENERATION_HORIZON_SECONDS = 600;

/**
 * The lookback handed to this model, and the floor below which it does not run.
 *
 * `spanUt` is game seconds of LOOKBACK, never a count of expected samples: the
 * stream is change-gated, so a rule that changed twice in half an hour carries
 * two points in that half hour and a rule under heavy load carries dozens.
 * Half an hour is long enough to hold a pair across a slow background craft's
 * turn rotation, and `maxSamples` thins a dense stretch to a fit that costs
 * the same.
 */
export const CREW_HISTORY: ReckonerWindow = {
  spanUt: 1800,
  maxSamples: 32,
  minSamples: 2,
};

type Crew = TopicPayload<"kerbalism.crew">;

/** A least-squares slope over irregularly spaced samples, and how well it is known. */
export interface ObservedSlope {
  /** Units per second of STAMP time. */
  readonly perSecond: number;
  /**
   * One standard error of `perSecond`, or `undefined` where the fit cannot
   * produce one.
   *
   * Absent at exactly two samples, and that is arithmetic rather than caution:
   * a straight line through two points has zero residual by construction and
   * `n - 2` degrees of freedom left, so the variance is `0/0`. A model asked
   * for a band on two samples answers with none, which is what
   * `TopicModel.bandAt` returning `undefined` is for.
   */
  readonly sigma: number | undefined;
  readonly samples: number;
}

/**
 * The least-squares slope through `(instant, value)` pairs, or `null` when the
 * pairs cannot express one.
 *
 * A fit rather than a difference of the two ends, because the number of pairs
 * is whatever the change-gated stream happened to carry: a rule that ticked
 * eleven times gives eleven points describing one slope, and reading only the
 * ends of that throws nine of them away and takes the noise on both.
 *
 * `null` on a degenerate x-axis is the case {@link pairsFor}'s doc is about:
 * every pair sharing one instant is not a shallow slope, it is no slope, and
 * the division that would produce one answers infinity.
 *
 * ## The standard error is the whole reason this is a fit and not a difference
 *
 * A fit has residuals, and residuals are evidence about how well the trend is
 * known. That is what lets this model offer a `sigma1` band where
 * `resourceReckoning.ts` can offer nothing: its rate is one measured sample
 * from the wire with no distribution behind it, and this one is an estimate
 * with a spread. So the window does not only make a RATE available where there
 * was none, it makes an UNCERTAINTY available, and the two arrive together
 * here so they cannot disagree.
 *
 * It is the error on the SLOPE only. The anchor the model integrates from is a
 * measurement whose own error nothing on this wire publishes, so the band this
 * feeds says how well the MODEL knows what it added, which is exactly what
 * `Reckoning.bands` is documented to mean.
 */
export function fitSlope(
  pairs: readonly (readonly [number, number])[],
): ObservedSlope | null {
  const n = pairs.length;
  if (n < 2) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
  }
  if (varianceX === 0) return null;
  const perSecond = covariance / varianceX;
  if (!Number.isFinite(perSecond)) return null;
  if (n < 3) return { perSecond, sigma: undefined, samples: n };
  const intercept = meanY - perSecond * meanX;
  let residualSquares = 0;
  for (const [x, y] of pairs) {
    residualSquares += (y - (intercept + perSecond * x)) ** 2;
  }
  const sigma = Math.sqrt(residualSquares / (n - 2) / varianceX);
  return {
    perSecond,
    sigma: Number.isFinite(sigma) ? sigma : undefined,
    samples: n,
  };
}

const clamp = (x: number, low: number, high: number): number =>
  x < low ? low : x > high ? high : x;

/** One accumulator this model is carrying, and everything it needs to do it. */
interface Moving {
  /** Index into the crew array, and into that kerbal's `rules`. */
  readonly kerbal: number;
  readonly rule: number;
  /** Dotted from the payload root, the key both `modelled` and `bands` use. */
  readonly path: string;
  readonly from: number;
  readonly slope: number;
  /** One standard error of `slope`, where the fit had enough samples for one. */
  readonly slopeSigma: number | undefined;
  readonly asOfUt: number;
  readonly ceiling: number;
}

/**
 * The `(asOfUt, value)` pairs one rule contributes across the window.
 *
 * Joined by NAME on both axes rather than by position: a crew list is a roster
 * and a kerbal can leave it, so index `1` in an older sample is not necessarily
 * the same person. A rule missing from an older sample simply contributes no
 * pair, which is what leaves the fit shorter rather than wrong.
 *
 * ## The window can span a change of SUBJECT, which the store does not cut at
 *
 * A break in the RECORD is truncated before a model sees it, and a change of
 * subject is not a break: the store hands back a contiguous run that may
 * straddle a vessel switch. `verticalAccelerationOver` reached the same
 * conclusion for a descent rate and filters the same way. The name join
 * already covers the common case, a kerbal being aboard exactly one craft, but
 * it covers it by accident rather than on purpose, and a name is not unique in
 * KSP: two saves' worth of recruits can hold the same one. Dropping every
 * sample from another `meta.source` makes it deliberate, and a step between two
 * craft is exactly the shape a fit would read as an enormous degeneration.
 */
function pairsFor(
  history: readonly TimelinePoint<Crew>[],
  subject: string,
  kerbalName: string,
  ruleName: string,
): (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  for (const point of history) {
    if (point.meta.source !== subject) continue;
    const entry = point.payload?.find((e) => e.name === kerbalName);
    const asOfUt = magnitudeOf(entry?.asOfUt);
    const rule = entry?.rules?.find((r) => r.name === ruleName);
    const at = magnitudeOf(rule?.value);
    if (asOfUt === null || at === null) continue;
    pairs.push([asOfUt, at]);
  }
  return pairs;
}

/**
 * Which accumulators are actually climbing or falling, settled before the model
 * is offered.
 *
 * A slope of exactly zero is not offered, and that is the whole verdict this
 * model exists to make: the rule was read and did not move, so its input
 * resource is aboard and the honest answer is the observation itself. A model
 * that answered anyway would be claiming arithmetic where there was none.
 */
function movingAccumulators(
  observed: Crew,
  history: readonly TimelinePoint<Crew>[],
  subject: string,
  viewUt: number,
): Moving[] {
  const moving: Moving[] = [];
  observed.forEach((entry, kerbal) => {
    const asOfUt = magnitudeOf(entry.asOfUt);
    if (asOfUt === null) return;
    const elapsed = viewUt - asOfUt;
    if (
      !Number.isFinite(elapsed) ||
      elapsed <= 0 ||
      elapsed > CREW_DEGENERATION_HORIZON_SECONDS
    ) {
      return;
    }
    entry.rules?.forEach((rule, index) => {
      const from = magnitudeOf(rule.value);
      if (from === null || entry.name == null || rule.name == null) return;
      const fit = fitSlope(pairsFor(history, subject, entry.name, rule.name));
      if (fit === null || fit.perSecond === 0) return;
      moving.push({
        kerbal,
        rule: index,
        path: `${kerbal}.rules.${index}.value`,
        from,
        slope: fit.perSecond,
        slopeSigma: fit.sigma,
        asOfUt,
        // The threshold is where this model stops describing anybody. Absent,
        // there is no ceiling to clamp at and the horizon is the only limit.
        ceiling: magnitudeOf(rule.fatalThreshold) ?? Number.POSITIVE_INFINITY,
      });
    });
  });
  return moving;
}

/**
 * The model, as a pure function of the observation, the window and the view
 * time. Lifted out of the registration for the same reason
 * `reckonResourceLevels` is: `kerbalism.crew` cannot carry a
 * `[SitrepReckonable]` mark (the gate refuses an array Topic outright, and
 * `value` sits on a nested type that publishes no Topic of its own), so a
 * plain `Reading` reduces every refusal here to `reckoning: "none"` and only a
 * direct caller can check which one fired.
 */
export function reckonCrewAccumulators(
  point: TimelinePoint<Crew>,
  { viewUt, history }: ReckonerFrame<Crew>,
) {
  const observed = point.payload;
  if (observed == null) {
    return {
      declined: {
        reason: "model-inapplicable" as const,
        note: "no crew roster was observed, so there is nothing to advance",
      },
    };
  }
  const moving = movingAccumulators(
    observed,
    history,
    point.meta.source,
    viewUt,
  );
  if (moving.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable" as const,
        note: "no accumulator aboard was observed to be moving, so every rule here is supplied and its value is the reading itself",
      },
    };
  }
  const modelled: readonly ModelledField[] = [
    { path: "", basis: "rate-integration" },
    ...moving.map(({ path }) => ({
      path,
      basis: "rate-integration" as const,
    })),
  ];
  return {
    modelled,
    reckon: (at: number): Crew => {
      /*
       * Cloned two levels deep, because that is how deep the moved field sits:
       * a shallow copy would write the new accumulator into the observation's
       * own rule object, and the observation is what `Reading.value` hands a
       * caller as the last REAL reading.
       */
      const next: Crew = observed.map((entry) => ({
        ...entry,
        rules: entry.rules?.map((rule) => ({ ...rule })),
      }));
      for (const carried of moving) {
        const target = next[carried.kerbal].rules?.[carried.rule];
        if (!target) continue;
        target.value = value("units", carriedValue(carried, at));
      }
      return next;
    },
    bandAt: (at: number): ReckonedBands | undefined => {
      const bands: Record<string, UncertaintyBand> = {};
      for (const carried of moving) {
        const { slopeSigma, asOfUt, ceiling } = carried;
        if (slopeSigma === undefined) continue;
        /*
         * The point estimate through the SAME function `reckon` uses.
         * `UncertaintyBand.value` has to equal the value reckoned at this path
         * (`bandIsWellFormed` is the check), and recomputing it here from the
         * same three numbers is how the two would eventually stop agreeing.
         */
        const centre = carriedValue(carried, at);
        const halfWidth = Math.abs(at - asOfUt) * slopeSigma;
        if (!Number.isFinite(halfWidth)) continue;
        bands[carried.path] = {
          value: value("units", centre),
          /*
           * Clamped to the same range the value is, because the range is not a
           * display convenience: below zero the accumulator does not exist,
           * and above the fatal threshold the kerbal is dead and no rate here
           * describes anybody. An end outside it would be an interval over
           * states that cannot occur, which is a worse claim than a narrow one.
           */
          lo: value("units", clamp(centre - halfWidth, 0, ceiling)),
          hi: value("units", clamp(centre + halfWidth, 0, ceiling)),
          kind: "sigma1",
        };
      }
      return Object.keys(bands).length > 0 ? bands : undefined;
    },
  };
}

/**
 * One accumulator carried to `at`, the single place the arithmetic lives.
 *
 * Shared by `reckon` and `bandAt` rather than written twice: the band's own
 * `value` must equal the value reckoned at the same path, and two copies of
 * `from + slope * dt` clamped the same way is exactly the pair that drifts.
 */
function carriedValue(
  { from, slope, asOfUt, ceiling }: Moving,
  at: number,
): number {
  return clamp(from + slope * (at - asOfUt), 0, ceiling);
}

KERBALISM.registerReckoner(KERBALISM_CREW_TOPIC, {
  deps: [],
  window: CREW_HISTORY,
  reckon: (point, _resolved, frame) => reckonCrewAccumulators(point, frame),
});
