import type {
  DerivedChannelDefinition,
  DerivedGet,
  ReckoningBasis,
} from "@ksp-gonogo/sitrep-client";
import type {
  StreamStatusValue,
  TopicPayload,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { KERBALISM_LIFESUPPORT_TOPIC } from "./topics";
import { KERBALISM } from "./uplink";

/**
 * `kerbalism.resourceProjection`: every life-support consumable, carried
 * forward from its last observed level at its last observed rate, with the
 * band that carrying implies.
 *
 * ## Why a derived channel rather than a reckoner
 *
 * Integrating a consumable needs three numbers and the contract puts them on
 * two Topics, deliberately. `vessel.resources` carries `current` and `max` for
 * every resource on the vessel; `kerbalism.lifesupport` carries `rates`, keyed
 * by the same resource name, and says why in terms: "Amounts and capacities
 * are deliberately NOT here... The rate is the one number the generic path
 * cannot derive, so it is the only one this channel adds."
 *
 * A `ReckonerFor` is handed ONE `TimelinePoint` and cannot see across that
 * split. A derived channel's `get` reaches both, pinned to one frozen view
 * time. So this is where the model lives, and the reckoning is the LABEL on
 * top of it (`deriveReckoning` below), exactly as `vessel.state` does for
 * orbital propagation.
 *
 * ## Which UT it integrates from, and it is not the wire's
 *
 * `asOfUt` is the UT Kerbalism last ADVANCED its accumulators, which for a
 * background craft can sit well behind the read time: unloaded vessels take
 * their Kerbalism turn one per tick, in rotation. So a payload can be
 * perfectly live on the wire and already minutes old as a model, and the
 * elapsed time to integrate over is `viewUt - asOfUt`, never `viewUt` minus
 * the sample's `validAt`. Two different clocks with confusingly similar names;
 * this one is the payload's.
 *
 * `asOfUt` null is a statement of ignorance the mod makes deliberately rather
 * than substituting a capture time, so a null means this channel declines to
 * project at all rather than guessing an elapsed interval.
 *
 * ## The band, and what it is NOT
 *
 * A rate was measured over some past interval and holds only while nothing
 * changes: a load shed, a process starting, a crew member waking. So a point
 * estimate rendered like an observation overstates what is known, which is why
 * `projected` never travels without `lower`/`upper`.
 *
 * The band brackets two NAMED scenarios rather than expressing a confidence
 * interval, because the wire carries exactly one rate sample and there is no
 * evidence from which to compute a distribution:
 *
 * - the rate held for the whole interval (the point estimate)
 * - the rate stopped the instant contact was lost (the level at last contact)
 *
 * Its width is therefore `|rate| * elapsed`, clamped, and it GROWS with the
 * gap. That growth is the honest difference between this and a propagated
 * orbit: a conic is as good after twenty minutes as after one, and a
 * consumable's projection is not.
 *
 * **It is not a bound on the truth.** A converter switching on can put the
 * real level outside it, and nothing on this wire would say so. It is the
 * interval an operator can reason about ("between four and ten percent"),
 * and the caveat belongs beside it in any widget that draws it.
 */
export interface KerbalismResourceProjection {
  /** Resource name, the key both input maps share. */
  name: string;
  /** The last OBSERVED level. Never modelled. */
  observed: Value<"units">;
  /** Capacity, the ceiling the projection clamps at. */
  capacity: Value<"units">;
  /** The last observed rate, signed: negative consumes. */
  rate: Value<"units/s">;
  /** Seconds of UT the projection was carried over, `viewUt - asOfUt`. */
  elapsed: Value<"s">;
  /** The point estimate: the rate held for the whole interval. */
  projected: Value<"units">;
  /** The lower of the two bracketed scenarios. */
  lower: Value<"units">;
  /** The upper of the two bracketed scenarios. */
  upper: Value<"units">;
}

export interface KerbalismResourceProjections {
  /** Sorted by name, so a render order is stable without a widget imposing one. */
  resources: KerbalismResourceProjection[];
}

export const KERBALISM_RESOURCE_PROJECTION_TOPIC =
  "kerbalism.resourceProjection";

const VESSEL_RESOURCES_TOPIC = "vessel.resources";

/** Structural subset of `vessel.resources`, which this Uplink does not own. */
interface VesselResourcesLike {
  resources?: Record<
    string,
    { current?: Value<"units">; max?: Value<"units"> } | undefined
  >;
}

type LifeSupport = TopicPayload<"kerbalism.lifesupport">;

const clamp = (x: number, low: number, high: number): number =>
  x < low ? low : x > high ? high : x;

export function deriveResourceProjections(
  get: DerivedGet,
  viewUt: number,
): KerbalismResourceProjections | null | undefined {
  const amountsPoint = get<VesselResourcesLike>(VESSEL_RESOURCES_TOPIC);
  const lifeSupportPoint = get<LifeSupport>(KERBALISM_LIFESUPPORT_TOPIC);
  // Nothing yet on either input: "not whole", never a fabricated empty map.
  if (!amountsPoint || !lifeSupportPoint) return undefined;
  // Either input a confirmed tombstone: no vessel, or Kerbalism gone. A
  // confirmed absence, not an empty projection.
  if (amountsPoint.payload === null || lifeSupportPoint.payload === null) {
    return null;
  }

  const amounts = amountsPoint.payload.resources ?? {};
  const rates = lifeSupportPoint.payload.rates ?? {};
  const asOfUt = lifeSupportPoint.payload.asOfUt;
  // A statement of ignorance, made deliberately mod-side rather than
  // substituted with a capture time. With no anchor there is no interval to
  // integrate over, so nothing is projected.
  if (asOfUt == null) return null;

  // Never negative: a sample can sit marginally ahead of the frame's view
  // time, and "carried for -0.4 s" is not a thing to model.
  const elapsed = Math.max(0, viewUt - asOfUt.magnitude);

  const resources: KerbalismResourceProjection[] = [];
  for (const name of Object.keys(rates).sort()) {
    const amount = amounts[name];
    const rate = rates[name];
    // A rate for a resource this vessel does not carry: nothing to project.
    if (!amount?.current || !amount.max || rate == null) continue;

    const observed = amount.current.magnitude;
    const capacity = amount.max.magnitude;
    const perSecond = rate.magnitude;
    const projected = clamp(observed + perSecond * elapsed, 0, capacity);
    // The two scenarios, ordered rather than assumed: a positive rate makes
    // the projection the upper end and a negative one makes it the lower.
    const low = Math.min(observed, projected);
    const high = Math.max(observed, projected);

    resources.push({
      name,
      observed: value("units", observed),
      capacity: value("units", capacity),
      rate: value("units/s", perSecond),
      elapsed: value("s", elapsed),
      projected: value("units", projected),
      lower: value("units", low),
      upper: value("units", high),
    });
  }
  return { resources };
}

/**
 * Whether this record is forward-modelled, and on what.
 *
 * Unlike a propagation, this is a model whether or not contact has been lost:
 * `asOfUt` can sit behind the read time on a live stream, because a background
 * craft takes its Kerbalism turn one tick in N. So the basis is offered
 * whenever the projection actually carried the value anywhere, which is what
 * a non-zero elapsed interval means, and withheld when the numbers are the
 * observation itself.
 *
 * No horizon is imposed here and that is deliberate rather than an omission: a
 * rate does not become false at a knowable moment the way a conic does past an
 * SOI change. It decays continuously, which is what the band is for, and
 * declining at an invented cutoff would replace an honest widening interval
 * with a cliff nobody could justify.
 */
export function deriveResourceProjectionReckoning(
  get: DerivedGet,
  viewUt: number,
  _getStatus: (topic: string) => StreamStatusValue,
): ReckoningBasis | undefined {
  const lifeSupportPoint = get<LifeSupport>(KERBALISM_LIFESUPPORT_TOPIC);
  const asOfUt = lifeSupportPoint?.payload?.asOfUt;
  if (asOfUt == null) return undefined;
  return viewUt > asOfUt.magnitude ? "rate-integration" : undefined;
}

export const kerbalismResourceProjectionChannel: DerivedChannelDefinition<KerbalismResourceProjections> =
  {
    topic: KERBALISM_RESOURCE_PROJECTION_TOPIC,
    inputs: [VESSEL_RESOURCES_TOPIC, KERBALISM_LIFESUPPORT_TOPIC],
    derive: deriveResourceProjections,
    deriveReckoning: deriveResourceProjectionReckoning,
    fields: true,
  };

KERBALISM.registerDerivedChannel(kerbalismResourceProjectionChannel);
