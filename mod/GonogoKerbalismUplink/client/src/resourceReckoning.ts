import type {
  ModelledField,
  ReckonerAnswer,
  ReckoningDecline,
  TopicPayload,
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
 */
export const RESOURCE_RATE_HORIZON_SECONDS = 1200;

type Resources = TopicPayload<"vessel.resources">;
type LifeSupport = TopicPayload<"kerbalism.lifesupport">;

const clamp = (x: number, low: number, high: number): number =>
  x < low ? low : x > high ? high : x;

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
 * `reckoning: "none"` and a consumer never sees which one fired. The reasons
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

  /*
   * Which levels actually move, settled BEFORE the model is offered. A rate
   * for a resource this vessel does not carry moves nothing, and neither does
   * a measured zero: a key present with 0 is Kerbalism's real statement that
   * the resource is in balance, so the honest answer for it is the
   * observation unchanged rather than a claim that arithmetic happened.
   */
  const moving: { name: string; perSecond: number }[] = [];
  for (const name of Object.keys(rates).sort()) {
    const amount = observed.resources[name];
    const perSecond = magnitudeOf(rates[name]);
    if (!amount || perSecond === null || perSecond === 0) continue;
    moving.push({ name, perSecond });
  }
  if (moving.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no resource this craft carries has a non-zero measured rate, so every level here is the observation itself",
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
      const dt = at - asOfUt;
      /*
       * Spread first, overwrite second: every sibling this model does not move
       * (the capacity, the presence flag, `meta`, and every resource with no
       * rate) travels verbatim, which is what `Reckoning.modelled` promises
       * about the paths it does not name.
       */
      const resources: Resources["resources"] = { ...observed.resources };
      for (const { name, perSecond } of moving) {
        const amount = observed.resources[name];
        const current = magnitudeOf(amount.current);
        const capacity = magnitudeOf(amount.max);
        if (current === null || capacity === null) continue;
        resources[name] = {
          ...amount,
          current: value("units", clamp(current + perSecond * dt, 0, capacity)),
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
