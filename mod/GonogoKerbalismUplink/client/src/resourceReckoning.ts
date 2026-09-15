import type {
  ModelledField,
  ReckonerAnswer,
  ReckoningDecline,
  TopicPayload,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import { KERBALISM_LIFESUPPORT_TOPIC } from "./topics";
import { KERBALISM } from "./uplink";

/**
 * `vessel.resources`, carried forward at the net rate Kerbalism measured.
 *
 * ## Why this is a reckoner now, when the same model was a derived channel
 *
 * `resourceProjection.ts` argues at length that this model cannot be a
 * reckoner, and states its reason plainly: "A `ReckonerFor` is handed ONE
 * `TimelinePoint` and cannot see across that split." The split is real and
 * deliberate (`vessel.resources` carries amounts and capacities,
 * `kerbalism.lifesupport` carries the rates, and the latter says in terms why),
 * but a reckoner is no longer handed one point: it DECLARES its inputs and the
 * store resolves them, so the rate arrives here as a dep. So the model belongs
 * on the Topic whose value it advances, where every existing reader of that
 * Topic gets it, rather than on a parallel Topic each widget has to know to
 * read instead.
 *
 * The Uplink owns it rather than core because core cannot: `vessel.resources`
 * publishes no rate at all (its own doc defers "flow/rates (R-2/R-5)"
 * deliberately), so the only party that can advance a level is whoever models
 * the consumption. `getReckoner` elects the sole non-core owner over core's
 * vanilla for exactly this case.
 *
 * ## Which UT it integrates from, and it is not the wire's
 *
 * `asOfUt` is the UT Kerbalism last ADVANCED its accumulators, and for a
 * background craft it sits well behind the read time: unloaded vessels take
 * their Kerbalism turn one per physics tick, in rotation. So a payload can be
 * perfectly live on the wire and already minutes old as a model, and the
 * interval to integrate over is `viewUt - asOfUt`, never `viewUt` minus the
 * sample's `validAt`.
 *
 * That is also why this model does NOT follow `core-reckoners`'
 * `elapsedOrDecline` and withhold itself on a live reading. That posture is
 * right for a first-order extrapolation whose only anchor is the loss of
 * contact: on a live reading it would replace a measured value with arithmetic
 * about the same instant. Here the gap being carried is the game's own
 * accumulator lag, which exists whether or not the last packet arrived on
 * time, so `Reading`'s `{state: "observed", reckoning: "available"}` arm is
 * the one this model wants and it is there for precisely this. What it declines
 * on instead is a ZERO interval, which is the same refusal measured against
 * the right clock.
 */

/**
 * How far a net consumable rate stays honest, in seconds.
 *
 * Chosen rather than measured, and stated here as one constant so widening it
 * is a decision somebody takes rather than a number that drifts. Two things
 * inform it. A `rates` entry is a NET rate over the whole vessel, so what
 * invalidates it is a discrete event: a converter switching, a crew shift, a
 * light coming on. The shortest such event with a knowable period is the
 * orbital shadow boundary, where a craft's net electric-charge rate flips sign
 * outright, and a low orbit crosses one every twenty minutes or so.
 *
 * ## Why a band does not replace it
 *
 * `resourceProjection.ts` imposes no horizon and gives a good reason: a rate
 * does not become false at a knowable moment the way a conic does past an SOI
 * change, it decays continuously, and the widening `lower`/`upper` bracket
 * beside it is what expresses that. `TopicModel.bandAt` now exists, so the
 * obvious move is to carry that bracket here and drop the constant. It is the
 * wrong move, because the two answer different questions.
 *
 * A band says HOW WRONG the number might be. A horizon says whether the model
 * still describes the same REGIME. Those come apart precisely here, because
 * what invalidates a `rates` entry is not accumulating noise but a DISCRETE
 * event: a converter switching, a crew shift, a craft crossing into shadow. At
 * a shadow boundary the net electric-charge rate flips SIGN, and after that the
 * model is not imprecise, it is integrating in the wrong direction. A band
 * widening symmetrically around a falling line does not contain a rising one,
 * so no interval this model could offer would cover the case the horizon is
 * for.
 *
 * Twenty minutes is roughly a low orbit, which is where that constant comes
 * from. The better version of this withdraws on EVIDENCE rather than at a
 * chosen number: window `kerbalism.lifesupport` through `depWindows` and
 * decline when the observed rate has changed sign inside the window. That is a
 * strictly better model and it is not this one.
 *
 * ## And why this model offers no band at all
 *
 * `BandKind` is `"bound" | "sigma1"` and the honest interval here is neither.
 * The bracket `resourceProjection.ts` mints spans two NAMED SCENARIOS (the rate
 * held for the whole interval; the rate stopped the instant contact was lost),
 * which its own doc is explicit is "not a bound on the truth", because a
 * converter switching on can put the real level outside it. It is not a sigma
 * either: the wire carries exactly one rate sample, so there is no distribution
 * to take a standard deviation of. Stamping `"bound"` on it would promise
 * containment this wire cannot support, and a fabricated band is worse than
 * none. `kerbalism.crew`'s model DOES band, because its rate is a fit with
 * residuals; see `crewReckoning.ts`.
 *
 * ## And why it is a CEILING on reach rather than the only reason to stop
 *
 * A level also withdraws the moment the model's own arithmetic carries it out
 * of the range the quantity can occupy, and for most tanks that comes a long
 * way first: a quarter-full tank filling at a unit a second is at its capacity
 * in three hundred seconds. See {@link resourceBoundaryCrossings}.
 */
export const RESOURCE_RATE_HORIZON_SECONDS = 1200;

type Resources = TopicPayload<"vessel.resources">;
type LifeSupport = TopicPayload<"kerbalism.lifesupport">;

/** Which end of `[0, capacity]` a moving level is heading for. */
export type ResourceBoundary = "floor" | "ceiling";

/**
 * The UT one level would leave the range it can occupy at, on the rate that was
 * measured.
 *
 * ## Why the model publishes this rather than clamping
 *
 * The level used to be clamped into `[0, capacity]` and the model went on
 * answering, which put a tank at ZERO on a craft whose last observation saw it
 * full, for as long as the horizon allowed. A clamp is not a withdrawal: it is
 * a confident positive claim, and at a readout it is indistinguishable from an
 * observation of an empty tank. The clamp was symmetric, so a positive net rate
 * did the same thing at the other end and reported a FULL one.
 *
 * The model stops at the crossing instead, and hands the crossed level back at
 * its last observed value. That withdrawal is honest and it is also silent,
 * which is why the moment itself is published: a consumer holding one can say
 * "empty by about UT X, modelled" where otherwise it could only show a level
 * that had quietly stopped moving.
 *
 * ## Why a UT, and why this vocabulary rather than a new one
 *
 * It is a time, and `Value<"ut">` is the spelling the reckoning vocabulary
 * already has for an absolute moment (`Reckoning.atUt` is one). A duration
 * would be the same fact measured from the frame, so it would have to be
 * recomputed every frame and would need a second anchor stated beside it to
 * mean anything at all. This one is a fact about the OBSERVATION and does not
 * move as the view time does.
 *
 * It sits on its own entry point rather than on the model's answer for exactly
 * that reason: it is not a function of `viewUt`, so a caller needs no frame to
 * ask for it, and it is still there on the frames where the model has withdrawn
 * and has no answer to hang it off.
 *
 * `boundary` names the END of the range rather than the condition, because the
 * two ends are one rule. Zero is not a special number here: a consumer renders
 * `"floor"` as empty and `"ceiling"` as full, and nothing upstream of that has
 * to know which of them a given craft is heading for.
 */
export interface ResourceBoundaryCrossing {
  readonly resource: string;
  readonly boundary: ResourceBoundary;
  readonly atUt: Value<"ut">;
}

/** One level the rates actually move, with the boundary it is heading for. */
interface MovingLevel {
  readonly name: string;
  readonly perSecond: number;
  readonly current: number;
  readonly boundary: ResourceBoundary;
  /** The UT it reaches that boundary at. Finite: the rate is non-zero. */
  readonly crossesAtUt: number;
}

/**
 * Which levels move, and when each one runs out of range.
 *
 * A rate for a resource this vessel does not carry moves nothing, and neither
 * does a measured zero: a key present with 0 is Kerbalism's real statement that
 * the resource is in balance, so the honest answer for it is the observation
 * unchanged rather than a claim that arithmetic happened. A level whose amount
 * or capacity cannot be read is dropped here as well, so the model never names
 * a path it then declines to move.
 */
function movingLevels(
  observed: Resources,
  rates: NonNullable<LifeSupport["rates"]>,
  asOfUt: number,
): MovingLevel[] {
  const moving: MovingLevel[] = [];
  for (const name of Object.keys(rates).sort()) {
    const amount = observed.resources[name];
    const perSecond = magnitudeOf(rates[name]);
    if (!amount || perSecond === null || perSecond === 0) continue;
    const current = magnitudeOf(amount.current);
    const capacity = magnitudeOf(amount.max);
    if (current === null || capacity === null) continue;
    const boundary: ResourceBoundary = perSecond < 0 ? "floor" : "ceiling";
    const distance = perSecond < 0 ? current : capacity - current;
    moving.push({
      name,
      perSecond,
      current,
      boundary,
      crossesAtUt: asOfUt + distance / Math.abs(perSecond),
    });
  }
  return moving;
}

/**
 * When each moving level leaves the range it can occupy, for a consumer that
 * wants to say WHEN. See {@link ResourceBoundaryCrossing}.
 *
 * Empty rather than a throw for every absence the model itself declines on: no
 * observation, no ledger, no rates, and no stamp to anchor the moment to.
 */
export function resourceBoundaryCrossings(
  observed: Resources | null,
  lifeSupport: LifeSupport | null | undefined,
): readonly ResourceBoundaryCrossing[] {
  if (observed == null || lifeSupport == null) return [];
  const rates = lifeSupport.rates;
  if (rates == null) return [];
  const asOfUt = magnitudeOf(lifeSupport.asOfUt);
  if (asOfUt === null) return [];
  return movingLevels(observed, rates, asOfUt).map(
    ({ name, boundary, crossesAtUt }) => ({
      resource: name,
      boundary,
      atUt: value("ut", crossesAtUt),
    }),
  );
}

/**
 * The interval to carry the accumulators across, or the reason not to.
 *
 * Never negative: a stamp can sit marginally ahead of the frame's view time,
 * and "carried for -0.4 s" is not a thing to model. Zero is a DECLINE rather
 * than an identity projection, because a model that answers with the
 * observation has modelled nothing and should not claim to have.
 */
function intervalOrDecline(
  asOfUt: number,
  viewUt: number,
): number | ReckoningDecline {
  const elapsed = viewUt - asOfUt;
  if (!Number.isFinite(elapsed)) {
    return {
      reason: "model-inapplicable",
      note: "the view time is not a number",
    };
  }
  if (elapsed <= 0) {
    return {
      reason: "model-inapplicable",
      note: "Kerbalism advanced these accumulators at this frame's view time, so there is no interval to carry them across",
    };
  }
  if (elapsed > RESOURCE_RATE_HORIZON_SECONDS) {
    return {
      reason: "beyond-horizon",
      input: "@kerbalism.lifesupport#rates",
      note: `a net consumable rate is honest for about ${RESOURCE_RATE_HORIZON_SECONDS} seconds and these were measured ${Math.round(elapsed)} seconds ago`,
    };
  }
  return elapsed;
}

/**
 * The model itself, as a pure function of the two payloads and the view time.
 *
 * Lifted out of the registration rather than written inside it so its DECLINE
 * REASONS are testable. `vessel.resources` carries no `[SitrepReckonable]` mark
 * (see this file's header for why the mark would be a promise core cannot
 * keep), so a plain `Reading` reduces every refusal below to
 * `reckoning: { status: "none" }` and a consumer never sees which one fired. The reasons
 * are still worth getting right, and a caller of this function is the only
 * thing that can check them.
 */
export function reckonResourceLevels(
  observed: Resources | null,
  lifeSupport: LifeSupport | null | undefined,
  viewUt: number,
): ReckonerAnswer<Resources> {
  if (observed == null) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no resource map was observed, so there is nothing to advance",
      },
    };
  }
  /*
   * The dep resolving to NOTHING is the store's decline, raised before this
   * runs. What reaches here is a tombstone: Kerbalism confirmed absent, or no
   * vessel. A confirmed absence of the rate is still an absent input, and the
   * contract's own spelling of it is what an operator wants read back.
   */
  if (lifeSupport == null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport",
        note: "Kerbalism reports no life-support ledger for this craft, so no rate is measured",
      },
    };
  }
  const rates = lifeSupport.rates;
  if (rates == null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport#rates",
      },
    };
  }
  const asOfUt = magnitudeOf(lifeSupport.asOfUt);
  if (asOfUt === null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport#asOfUt",
        note: "Kerbalism's own last-evaluation marker could not be read, and a capture time substituted for it would claim a freshness nobody measured",
      },
    };
  }
  const elapsed = intervalOrDecline(asOfUt, viewUt);
  if (typeof elapsed !== "number") return { declined: elapsed };

  // Which levels actually move, settled BEFORE the model is offered.
  const rated = movingLevels(observed, rates, asOfUt);
  if (rated.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no resource this craft carries has a non-zero measured rate, so every level here is the observation itself",
      },
    };
  }

  /*
   * And which of those the model still holds for. A tank cannot hold less than
   * nothing or more than its capacity, so a rate that would carry a level past
   * either end is a rate that has demonstrably stopped holding by then, whether
   * or not the horizon has been reached. That is the same refusal
   * `beyond-horizon` already names, against the same input, measured on this
   * level rather than on the clock: reaching for a second reason code would
   * imply a consumer should treat the two differently, and it should not.
   */
  const moving = rated.filter((level) => viewUt < level.crossesAtUt);
  if (moving.length === 0) {
    const last = rated.reduce((a, b) =>
      a.crossesAtUt >= b.crossesAtUt ? a : b,
    );
    return {
      declined: {
        reason: "beyond-horizon",
        input: "@kerbalism.lifesupport#rates",
        note: `the last level to leave the range it can occupy, ${last.name}, reaches ${last.boundary === "floor" ? "empty" : "capacity"} at UT ${Math.round(last.crossesAtUt)}, and no measured rate carries a level past that`,
      },
    };
  }

  const modelled: readonly ModelledField[] = [
    { path: "", basis: "rate-integration" },
    ...moving.map(({ name }) => ({
      path: `resources.${name}.current`,
      basis: "rate-integration" as const,
    })),
  ];

  return {
    modelled,
    reckon: (at) => {
      /*
       * Spread first, overwrite second: every sibling this model does not move
       * (the capacity, the presence flag, `meta`, every resource with no rate,
       * and every level that has left its range) travels verbatim, which is
       * what `Reckoning.modelled` promises about the paths it does not name.
       */
      const resources: Resources["resources"] = { ...observed.resources };
      for (const { name, perSecond, current, crossesAtUt } of moving) {
        // The filter above settles COVERAGE, for the frame's own view time.
        // This settles the VALUE, for whatever time the caller asks at, so a
        // pull at some other `at` cannot get a level out of its range either.
        if (at >= crossesAtUt) continue;
        resources[name] = {
          ...observed.resources[name],
          current: value("units", current + perSecond * (at - asOfUt)),
        };
      }
      return { ...observed, resources };
    },
  };
}

KERBALISM.registerReckoner("vessel.resources", {
  deps: [KERBALISM_LIFESUPPORT_TOPIC],
  reckon: (point, [lifeSupportPoint], { viewUt }) =>
    reckonResourceLevels(point.payload, lifeSupportPoint?.payload, viewUt),
});
