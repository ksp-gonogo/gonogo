import type {
  Dep,
  ProcessorHandle,
  ReadingDep,
  SubjectDep,
} from "./spine/processors";
import type { TimelinePoint } from "./timeline";
import type { TopicId, TopicPayload } from "./topics";
import { isUnit } from "./unit-system/guards";
import type { Value } from "./unit-system/value";

/**
 * What a telemetry read returns, and how a widget may use it.
 *
 * This lives in the SDK because `useTelemetry` returns a `Reading`, and the
 * client depends on the SDK, never the reverse.
 *
 * Everything here is consumer-side and total over the union: the type, its
 * reckoning types, the accessors, declining a reckoning, and measuring an age.
 * A third-party author needs all of it to USE a reading. What stays in the
 * client is the producer half, which needs the timeline and the store: minting
 * a reading from a stored point, and the reckoner registry.
 */

/**
 * Which model produced a reckoning.
 *
 * A closed union rather than a string, so adding a basis is a DECLARATION
 * rather than a spelling. An operator calibrates their trust in a propagated
 * number against what produced it, and a free-form string lets two providers
 * describe the same model differently (or misdescribe it) with nothing to
 * notice. Add a member here, with a line saying what it assumes and therefore
 * where it stops being true.
 *
 * - `kepler-propagation`: a two-body propagation of an orbital state. Honest
 *   for as long as the conic holds, which is until a burn, an SOI change or a
 *   perturbation the propagator does not model
 * - `linear-dead-reckoning`: position advanced by its last observed velocity.
 *   First-order only, so it is honest for seconds where the true motion is
 *   curved (any orbiting pair) and longer where it is not
 * - `rate-integration`: a quantity advanced by its last observed rate of
 *   change. Honest while the rate holds, which for a consumable means until
 *   something switches a converter, a light or a crew member
 * - `combination`: arithmetic over several readings resolved against ONE view
 *   time. The odd member: it carries nothing forward. The other three say "how
 *   did this number get from its observation to now"; this one says "how did
 *   this number come to exist at all", and the forward step, where there was
 *   one, happened inside each input under its own basis. So it is honest
 *   exactly as far as its inputs are, and no further: read
 *   {@link combineReadings} for the currency rule, and the inputs themselves for what
 *   actually propagated
 *
 * @category Reckoners
 */
export type ReckoningBasis =
  | "combination"
  | "kepler-propagation"
  | "linear-dead-reckoning"
  | "rate-integration";

/**
 * A forward-modelled value: what a provider's model says the quantity is at the
 * craft's present (SCET), given the last real observation and however long ago
 * it was.
 *
 * `atUt` is the UT the reckoning is FOR, the frame's SCET, not the UT the
 * observation behind it was made at (`Reading`'s `asOfUt` carries that). Both
 * are needed: an operator reads a modelled figure against how far it has been
 * carried.
 *
 * @category Reckoners
 */
export interface TopicReckoningAvailable<Payload> {
  /**
   * The discriminant, spelled the same way {@link Reckoning}'s is so a caller
   * asks one question of a topic and of a field.
   */
  readonly status: "available";
  value: Payload;
  atUt: Value<"ut">;
  /**
   * Whether `atUt` is past the edge the observation was received at by a gap an
   * operator could see: true under signal delay, where the model carries a
   * current reading across the light-time, and false on a LAN session. A figure
   * drawn from a reckoning that reaches beyond the received edge is modelled
   * rather than fresh, whatever the reading's state.
   */
  beyondReceived: boolean;
  basis: ReckoningBasis;
  /**
   * Which paths inside `value` the model actually MOVED, dotted from the
   * payload root. Everything not named here is a verbatim copy of the last
   * observation, carried along because `value` is the whole payload.
   *
   * It exists because a payload is not one reckoning class. `vessel.target`
   * flattens to forty-seven field paths: relative geometry that propagates,
   * identity fields only a command changes, two absolute UTs, and metadata.
   * A model that dead-reckons the relative position and copies the rest would
   * otherwise stamp `basis: "linear-dead-reckoning"` on the vessel's NAME,
   * which is a modelled label over a held observation.
   *
   * `basis` above stays, and is the basis of the entry covering the root. A
   * whole-topic read only reaches `reckoning: "available"` when the model covers
   * the root (see `TopicModel`), so it is always well defined on a reckoning a
   * caller can hold.
   */
  modelled: readonly ModelledField[];
  /**
   * Which registered owner's model produced this. `"core"` for the vanilla
   * every installed client ships.
   *
   * Reckonability is STATIC (the contract declares it), so the question at
   * runtime is not whether a value can be carried forward but WHICH model
   * carried it. That is the same question `vessel.maneuver.planner` already
   * settles by naming its winner, and naming it is what lets an operator tell
   * core's conic from an Uplink's without reading the numbers and guessing.
   */
  owner: string;
  /**
   * How well the model knows what it just said, per path, where it is prepared
   * to say. Absent from most reckonings and that is the honest majority.
   *
   * Keyed the same way `modelled` names paths, so the two line up without a
   * join: `modelled` says a path moved and by which model, `bands` says how
   * far that model would defend the number. See {@link ReckonedBands}.
   */
  readonly bands?: ReckonedBands;
}

/**
 * What a forward model says about a whole Topic this frame: it produced a
 * value, none was offered, or one was declared and could not produce a value.
 *
 * When a model produces a value, `modelled` lists the payload fields it moved
 * and `bands` how far it would defend each. `"declined"` happens only on a
 * Topic whose contract declares a model, and names the input that stopped it.
 *
 * @typeParam Payload - The Topic's payload type.
 *
 * @category Reading telemetry
 */
export type TopicReckoning<Payload> =
  | TopicReckoningAvailable<Payload>
  | { readonly status: "none" }
  | { readonly status: "declined"; readonly declined: ReckoningDecline };

/**
 * The reckoning states a DECLARED value's topic reading may carry: the model
 * ran, or it said why it could not. Never the silent `"none"`.
 *
 * The declaration is a promise that the wire carries the model's inputs, so on
 * a value-bearing reading there is no such thing as nothing-to-say. Dropping
 * `"none"` here is what makes that promise a compile-time fact rather than a
 * convention.
 *
 * @category Reckoners
 */
export type DeclaredTopicReckoning<Payload> = Exclude<
  TopicReckoning<Payload>,
  { readonly status: "none" }
>;

/**
 * One path a model moved, and what moved it. See
 * {@link TopicReckoningAvailable.modelled}.
 *
 * @category Reckoners
 */
export interface ModelledField {
  /** Dotted from the payload root. `""` is the whole payload. */
  readonly path: string;
  readonly basis: ReckoningBasis;
}

/**
 * What an {@link UncertaintyBand}'s two ends CLAIM.
 *
 * A hard bound and a one-sigma estimate are different statements about the same
 * two numbers, and without this field two producers would mean different things
 * by an identical interval with nothing able to notice. A consumer comparing a
 * band against a threshold is entitled to a different result for each: crossing
 * a hard bound is impossible, crossing one sigma happens about a third of the
 * time.
 *
 * - `bound`: the model asserts the true value is INSIDE `[lo, hi]`. Only
 *   honest where the model's error is genuinely capped (a quantisation, an
 *   interval arithmetic, an integrator with a proven residual)
 * - `sigma1`: one standard deviation either side of `value`. The true value is
 *   outside it roughly a third of the time, and a widget must not draw or
 *   phrase it as a limit
 *
 * @category Reckoners
 */
export type BandKind = "bound" | "sigma1";

/**
 * How well a model knows the number it just produced: an ASYMMETRIC interval
 * in the value's own unit.
 *
 * ## In the unit, never a percentage
 *
 * A percentage dies at a zero crossing, and reckoned quantities cross zero
 * constantly: vertical speed at apoapsis, relative position at closest
 * approach, a rendezvous drift rate as it nulls. "±5%" of zero is zero, so the
 * band would collapse to nothing at exactly the instant an operator most needs
 * it. Absolute bounds also compose with the unit algebra, so `hi.minus(lo)` is
 * a width in the same unit, and a band over a derived unit divides and
 * multiplies exactly as the value it describes does.
 *
 * ## Asymmetric, because the real error is
 *
 * `lo` and `hi` are given separately rather than as one `±`. A Kepler altitude
 * near periapsis is wrong in one direction far more than the other, and a burn
 * being late is not as recoverable as it being early. A single half-width
 * would have to take the worse side and would then overstate the better one,
 * which for a decision-shaped consumer is the difference between "cannot yet
 * say" and a usable verdict.
 *
 * ## `value` is here as well as on the reckoning, deliberately
 *
 * It duplicates {@link Reckoning.value} at the same path. Asymmetry is why:
 * `lo` and `hi` alone do not say where the estimate sits between them, so
 * every consumer needs all three at once and a band without its own value is
 * never usable alone. Carrying it makes a band the single argument to a
 * threshold comparison, a marker sizer or a chart, with no path walk at the
 * call site. A producer must keep it equal to the value it reckoned for that
 * path; `bandIsWellFormed` is the check, and the store's own suite asserts it.
 *
 * @category Reckoners
 */
export interface UncertaintyBand<Unit extends string = string> {
  /** The model's point estimate: the same number `reckon` produced here. */
  readonly value: Value<Unit>;
  /** The low end. Never above `value`. */
  readonly lo: Value<Unit>;
  /** The high end. Never below `value`. */
  readonly hi: Value<Unit>;
  readonly kind: BandKind;
}

/**
 * The bands a model offers for one frame, keyed by the same dotted paths
 * {@link ModelledField.path} uses. `""` is the payload root.
 *
 * Sparse on purpose, and a model that bands nothing returns `undefined` rather
 * than an empty map. Most models cannot produce a band honestly, and a
 * fabricated one is worse than none: it is a claim about how well a number is
 * known, made by something that does not know.
 *
 * A path here that no {@link ModelledField} names is a producer bug rather
 * than a second way to claim coverage. Nothing rejects it, because the
 * consumer reads bands BY path and never enumerates them, so an orphan is
 * simply never asked for.
 *
 * @category Reckoners
 */
export type ReckonedBands = {
  readonly [path: string]: UncertaintyBand | undefined;
};

/**
 * What a reckoner offers: the coverage it claims, and the pull that produces
 * the modelled payload.
 *
 * Coverage sits OUTSIDE the thunk because the store has to know what a model
 * covers before deciding which reading to build, and running the model to find
 * out would defeat the pull. A model that does not cover the payload root
 * cannot cover a whole-topic read, so that read stays `held`.
 *
 * `Projection` is what the pull RETURNS, and it defaults to the whole payload
 * because that is what a whole-topic model produces. A model declared per VALUE
 * returns the projection of the fields it moves instead, so `Projection` is
 * `Pick<Payload, ReckonableKey>` there. Two parameters rather than one because
 * the coverage claim is still about paths on `Payload` whichever shape the
 * result takes.
 *
 * @category Reckoners
 */
export interface TopicModel<Payload, Projection = Payload> {
  /** Paths this model moves. Empty claims nothing and is never offered. */
  readonly modelled: readonly ModelledField[];
  /** Run the model for `viewUt`. Pure: same inputs, same result. */
  reckon(viewUt: number): Projection;
  /**
   * How well the model knows its result for `viewUt`, per path. Optional, and
   * `undefined` is the right result for a model that cannot bound its own
   * error: see {@link ReckonedBands}.
   *
   * ## Why this is a second PULL and not a field on `modelled`
   *
   * `{ path, basis, band? }` on {@link ModelledField} reads better and cannot
   * work. Coverage sits outside the thunk precisely so the store can choose a
   * reading without running the model, and a band is a function of how far the
   * value has been carried, so it is not knowable until `viewUt` is. Putting
   * one on the coverage claim would either force the model to run before the
   * reading was chosen, or freeze one frame's interval and report it forever.
   *
   * Called at the same `viewUt` as `reckon`, immediately after it and only
   * when the model was actually used, so a model that shares work between the
   * two can cache on the argument. Pure on the same terms `reckon` is.
   */
  bandAt?(viewUt: number): ReckonedBands | undefined;
}

/**
 * Why a model could not run for this frame, on a topic whose contract
 * DECLARES a value reckonable.
 *
 * On a plain {@link Reading}, `reckoning: { status: "none" }` is the usual case
 * and needs no explanation: most topics have no model and never will. On a
 * declared value it is a specific refusal, because the declaration is a promise
 * that the wire carries the model's inputs, so the only ways to reach `"none"`
 * are that an input did not arrive, that the model was asked past where it
 * holds, or that the model does not apply to this frame at all. A refusal a
 * widget can render ("no conic past the SOI transition") beats a silent
 * absence, which is why it is REQUIRED on the value-bearing `"none"` reckonings
 * rather than optional. It sits on the reckoning and NOT inside `reckoned`,
 * which is the rule {@link Reading}'s own doc states under "No horizon field":
 * a caller holding a reckoning must never discover at call time that the
 * capability has gone bad. A model still withdraws by not being offered on the
 * next frame. All that has changed is that a declared value says WHY it
 * withdrew.
 *
 * `input` names the declared input that was missing or that ruled the model out,
 * spelled exactly as the contract declares it (`relativeVelocity`,
 * `@vessel.orbit`, `@vessel.orbit#mu`), so the string a widget shows and the
 * string the contract carries are the same string.
 *
 * `"under-physics"` means the subject is being stepped by the full simulation
 * rather than coasting, so a closed-form model of its motion does not apply:
 * a craft whose elements are osculating because something is pushing it. It is
 * its own member rather than a kind of `"model-inapplicable"` because a
 * consumer has a different thing to say about it (the orbit exists and the
 * craft is loaded) and must not have to infer that from `input` or `note`.
 *
 * **Every condition a consumer can branch on is a `reason`.** `input` names the
 * responsible input and several conditions share one; `note` is prose. Neither
 * says which condition fired, so a consumer that needs to know gets a member
 * here rather than a pattern to match.
 *
 * `"insufficient-history"` is the one the STORE raises on the reckoner's behalf
 * without consulting it, and the only rejection {@link ReckonerWindow} has: the
 * declared window held fewer than `minSamples` points of the reckoner's own
 * topic, so a model that needs a trend has nothing to take one from. It carries
 * no `input`, because the topic being read is not one of its own declared
 * inputs; the `note` says how many samples were found and whether a gap is what
 * cut them down.
 *
 * @category Reckoners
 */
export interface ReckoningDecline {
  readonly reason:
    | "input-absent"
    | "beyond-horizon"
    | "model-inapplicable"
    | "under-physics"
    | "contested"
    | "insufficient-history";
  /** The declared input responsible, where the reason has one. */
  readonly input?: string;
  /**
   * One sentence for an operator. Never a stack, never a code, and never read
   * by a program: a branch on its text is a branch on wording that can change.
   */
  readonly note?: string;
}

/**
 * What a reckoner returns: a model, or a refusal that says which input failed
 * it, so an input that never arrived is told apart from a horizon that has been
 * passed.
 *
 * `Projection` is the projection the model produces, which for a declared value
 * is `Pick<Payload, ReckonableKey>` rather than the whole payload. See
 * {@link ReckonableReading}.
 *
 * @category Reckoners
 */
export type ReckonerAnswer<Payload, Projection = Payload> =
  | TopicModel<Payload, Projection>
  | { readonly declined: ReckoningDecline };

/**
 * A Topic's payload together with how current it is. {@link useTelemetry}
 * returns one.
 *
 * ## States
 *
 * `state` says what the reading holds, and the payload can only be reached
 * after checking it:
 *
 * | `state` | Meaning | Carries | | --- | --- | --- | | `"pending"` | Nothing
 * has arrived yet: a Topic just subscribed, or a resync after a rewind |
 * nothing | | `"unowned"` | Nothing will ever publish this Topic: no installed
 * Uplink declares it | nothing | | `"absent"` | The game confirmed there is no
 * value, such as no target set | `atUt` | | `"observed"` | The newest value
 * that could have reached us | `value`, `atUt` | | `"held"` | Updates
 * stopped arriving, so this is the last value received | `value`, `asOfUt`,
 * `grade` |
 *
 * A held value is shown as held, never as current. {@link HeldGrade} says why
 * updates stopped. There is no zero standing in for a missing value: the
 * first three states carry no payload at all.
 *
 * ## Signal delay
 *
 * Under a light-time delay every value is old. A value 4 s old under a 4 s
 * delay is as current as it can be, and is `"observed"`, not held.
 *
 * ## Modelled values
 *
 * Separately from `state`, `reckoning` says whether a forward model can say
 * what the value is now (see {@link TopicReckoning}). It is usually
 * `{ status: "none" }`. When it is `"available"`, `reckoning.value` is the
 * model's value for this frame, and a band, where the model gives one, says how
 * far it would defend it. A missing band does not mean the value is well known.
 *
 * ## Fields
 *
 * Every payload field is also a {@link Reading} of its own, as a plain
 * property (`flight.altitudeAsl`) in every state, so a single field can be
 * passed on alone.
 *
 * @typeParam Payload - The Topic's payload type, such as `VesselFlight`.
 *
 * @category Reading telemetry
 */
export type TopicReading<Payload> = TopicCurrency<
  Payload,
  TopicReckoning<Payload>
> &
  TopicFields<Payload>;

/**
 * The part of a Topic reading that says how current it is: `state`, the value
 * where there is one, and when it was observed, without the per-field
 * readings.
 *
 * Ask for this type when only the observation matters: every Topic reading
 * satisfies it.
 *
 * @typeParam Payload - The Topic's payload type.
 * @typeParam ReckoningShape - What `reckoning` may hold on the states that
 * carry a value.
 *
 * @category Reading telemetry
 */
export type TopicCurrency<Payload, ReckoningShape = unknown> =
  | { state: "pending"; reckoning: { readonly status: "none" } }
  | { state: "unowned"; reckoning: { readonly status: "none" } }
  | {
      state: "absent";
      reckoning: { readonly status: "none" };
      atUt: Value<"ut">;
    }
  | {
      state: "observed";
      /** The observation itself. Never a modelled value; see `reckoning`. */
      value: Payload;
      atUt: Value<"ut">;
      reckoning: ReckoningShape;
    }
  | {
      state: "held";
      /** The last REAL observation. Never a modelled value. */
      value: Payload;
      /** The UT that observation was made at. */
      asOfUt: Value<"ut">;
      grade: HeldGrade;
      reckoning: ReckoningShape;
    };

/**
 * The per-field part of a Topic reading: a {@link FieldReading} for each
 * payload field, as a plain property (`flight.altitudeAsl.reckoning.band`).
 *
 * Each field reading has the same state and model as the Topic reading it
 * comes from. A field named like one of the reading's own properties
 * (see {@link ReservedReadingKey}) has no field reading; read it off the
 * payload. An array payload is read by index.
 *
 * @typeParam Payload - The Topic's payload type.
 *
 * @category Reading telemetry
 */
export type TopicFields<Payload> = Payload extends Quantityish
  ? unknown
  : Payload extends readonly (infer Element)[]
    ? { readonly [index: number]: FieldReading<Element> }
    : Payload extends (...args: never[]) => unknown
      ? unknown
      : Payload extends object
        ? {
            // Reserved names are excluded until RtConfig's reserved-name debt lists are empty; then drop the Exclude.
            readonly [Key in Exclude<
              keyof Payload,
              ReservedReadingKey
            >]-?: FieldReading<NonNullable<Payload[Key]>>;
          }
        : unknown;

/**
 * One field's reading, with the readings of the fields inside it:
 * `crew[kerbal].rules[index].value` reaches as deep as the payload goes.
 *
 * A quantity or a function is read whole; an array is read by index.
 *
 * @typeParam Payload - The field's type.
 *
 * @category Reading telemetry
 */
export type FieldReading<Payload> = Reading<Payload> & TopicFields<Payload>;

/**
 * The structural shape of a quantity, which recursion stops at.
 *
 * Structural rather than an import of `Value` so this file stays under the
 * unit system rather than beside it, and so a quantity arriving through an
 * alias or a re-export is still recognised as a leaf.
 */
type Quantityish = { readonly magnitude: number; readonly unit: string };

/**
 * The names of a reading's own properties. A payload field with one of these
 * names has no field reading; read it off the payload instead.
 *
 * @category Reading telemetry
 */
export type ReservedReadingKey =
  | "state"
  | "value"
  | "atUt"
  | "asOfUt"
  | "grade"
  | "reckoning";

/**
 * What a forward model says about one value this frame: it produced a value,
 * none was offered, or one was declared and could not produce a value.
 *
 * `modelled` exists only when `status` is `"available"`, and `declined` only
 * when it is `"declined"`. `band` is optional even then: most models cannot
 * bound their own error.
 *
 * @typeParam Payload - The type of the value modelled.
 *
 * @category Reading telemetry
 */
export type Reckoning<Payload> =
  | {
      readonly status: "available";
      /** What the model says the value is at {@link atUt}. */
      readonly modelled: Payload;
      /** The instant `modelled` is for: the frame's SCET. */
      readonly atUt: Value<"ut">;
      /** See {@link TopicReckoningAvailable.beyondReceived}. */
      readonly beyondReceived: boolean;
      readonly basis: ReckoningBasis;
      /** How far the model would defend `modelled`, where it will say. */
      readonly band?: UncertaintyBand;
    }
  | { readonly status: "none" }
  | { readonly status: "declined"; readonly declined: ReckoningDecline };

/**
 * One value together with how current it is: what a payload field of a
 * {@link TopicReading} is.
 *
 * `state` has the same meanings as on a {@link TopicReading}. `value` is set
 * only when `state` is `"observed"` or `"held"`.
 *
 * @typeParam Payload - The type of the value: a `Value` for a quantity, such as
 * `Value<"m">`, or a field's own type for anything else.
 *
 * @category Reading telemetry
 */
export interface Reading<Payload> {
  /** What the reading holds. See {@link TopicReading} for each state. */
  readonly state: ReadingState;
  /** The last value observed, when `state` is `"observed"` or `"held"`. Never a modelled value. */
  readonly value?: Payload;
  /** When the value was observed, or confirmed absent. */
  readonly atUt?: Value<"ut">;
  /** When a held value was observed. */
  readonly asOfUt?: Value<"ut">;
  /** Why a held value stopped updating. */
  readonly grade?: HeldGrade;
  /** What a forward model says the value is now. */
  readonly reckoning: Reckoning<Payload>;
}

/**
 * The reading of a Topic whose contract declares a forward model, such as
 * `vessel.flight` or `vessel.orbit`.
 *
 * It differs from {@link TopicReading} in two ways. `reckoning.value` holds
 * only the fields the model moves (`ReckonableKey`), so reading any other field
 * from the model does not compile. And when the reading carries a value,
 * `reckoning` is never `"none"`: either the model produced a value, or
 * `declined` says what stopped it.
 *
 * To combine the two, write `{ ...reading.value, ...reading.reckoning.value }`
 * where the model's value is wanted.
 *
 * @typeParam Payload - The Topic's payload type.
 * @typeParam ReckonableKey - The payload fields the model moves.
 *
 * @category Reading telemetry
 */
export type ReckonableReading<
  Payload,
  ReckonableKey extends keyof Payload,
> = TopicCurrency<
  Payload,
  DeclaredTopicReckoning<Pick<Payload, ReckonableKey>>
> &
  TopicFields<Payload>;

/**
 * Why a held reading (`state: "held"`) stopped updating.
 *
 * - `held`: this Topic's own updates stopped arriving on schedule
 * - `disconnected`: the connection to the game is down, which affects every
 *   Topic at once
 * - `last-before-blackout`: the last value sent before a known loss of signal
 * - `recorded`: recorded by the craft while out of contact and sent on
 *   reacquisition. Exact for its own `asOfUt`, but still not the state of the
 *   craft now
 *
 * The grade changes the label, not the drawing: a held value is drawn as held
 * whatever its grade.
 *
 * @category Reading telemetry
 */
export type HeldGrade =
  | "held"
  | "disconnected"
  | "last-before-blackout"
  | "recorded";

/**
 * The values `state` can take on a reading: `"pending"`, `"unowned"`,
 * `"absent"`, `"observed"` and `"held"`.
 *
 * @category Reading telemetry
 */
export type ReadingState = TopicCurrency<unknown>["state"];

/**
 * The values `reckoning.status` can take on a reading: `"available"`,
 * `"none"` and `"declined"`.
 *
 * @category Reading telemetry
 */
export type ReadingReckoning = Reckoning<unknown>["status"];

/**
 * Returns the reading with its forward model removed: `reckoning` becomes
 * `{ status: "none" }` and `state` is unchanged, so a held value stays held.
 *
 * Use it for a readout that shows the last observed number, marked as held
 * when it is, and never a modelled one. Never use it for anything that draws a
 * position or an attitude: a marker placed at a last-known value claims to
 * know where the craft is now.
 *
 * @category Reading telemetry
 */
// The ReckonableReading overload must come first: the wider one would accept it and narrow the return to the projection.
export function withoutReckoning<Payload, ReckonableKey extends keyof Payload>(
  reading: ReckonableReading<Payload, ReckonableKey>,
): UnmodelledReading<Payload>;
export function withoutReckoning<Payload>(
  reading: TopicReading<Payload>,
): UnmodelledReading<Payload>;
export function withoutReckoning<Payload>(
  reading: TopicReading<Payload> | ReckonableReading<Payload, keyof Payload>,
): UnmodelledReading<Payload> {
  /*
   * The SAME object where there was nothing to drop, because a widget calling
   * this on an unmodelled reading must not pay a new identity for it: the store
   * hands out one reading per topic per frame precisely so a `useSyncExternal
   * Store` subscriber can compare by reference. The cast is what the narrowing
   * cannot say: `reckoning.status` narrows the reckoning and not the arm
   * carrying it, so the compiler still holds the wider member type.
   */
  if (reading.reckoning.status === "none")
    return reading as UnmodelledReading<Payload>;
  if (reading.state === "pending" || reading.state === "unowned") {
    return topicReading({
      state: reading.state,
      reckoning: { status: "none" },
    });
  }
  if (reading.state === "absent") {
    return topicReading({
      state: "absent",
      reckoning: { status: "none" },
      atUt: reading.atUt,
    });
  }
  if (reading.state === "observed") {
    return topicReading({
      state: "observed",
      reckoning: { status: "none" },
      value: reading.value,
      atUt: reading.atUt,
    });
  }
  return topicReading({
    state: "held",
    reckoning: { status: "none" },
    value: reading.value,
    asOfUt: reading.asOfUt,
    grade: reading.grade,
  });
}

/**
 * A Topic reading with no model on offer: `reckoning` is always
 * `{ status: "none" }`, so there is no modelled value to reach for.
 *
 * {@link withoutReckoning} returns one. Held values still have to be handled.
 *
 * @typeParam Payload - The Topic's payload type.
 *
 * @category Reading telemetry
 */
export type UnmodelledReading<Payload> = TopicCurrency<
  Payload,
  { readonly status: "none" }
> &
  TopicFields<Payload>;

/**
 * Returns the value of an `"observed"` reading, and `undefined` in every other
 * state, held included.
 *
 * Use it where a value only means something while it is current: a verdict, a
 * status, whether a control can be pressed. To show a held value, check for
 * `state === "held"` and date it with {@link observedAt}. It never uses a
 * forward model.
 *
 * @example
 * ```ts
 * const flight = observedValue(useTelemetry("vessel.flight"));
 * const descending = flight !== undefined && flight.verticalSpeed.lessThan(0);
 * ```
 *
 * @category Reading telemetry
 */
export function observedValue<Payload>(
  reading: TopicCurrency<Payload>,
): Payload | undefined {
  return reading.state === "observed" ? reading.value : undefined;
}

/**
 * Returns the value of a fact: something that stays true until an event
 * changes it, such as a craft's name or a part's presence. A held value is
 * returned as well as an observed one, since no event could have changed it
 * unseen.
 *
 * Returns `whenConfirmedNothing` for an `"absent"` reading, and `undefined`
 * while `"pending"` or `"unowned"`.
 *
 * Only for facts. A measurement that drifts on its own, such as a position or
 * a fuel level, is not still true once updates stop; use
 * {@link observedValue}.
 *
 * @category Reading telemetry
 */
export function stillTrue<Payload, Fallback>(
  reading: TopicCurrency<Payload>,
  whenConfirmedNothing: Fallback,
): Payload | Fallback | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "held") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * One PART of a payload, still carrying the whole reading's currency: the
 * narrowing to write when a primitive draws a single field and has to know
 * whether that field is current.
 *
 * `<Unit>` takes a `Reading<Value<Unit>>`, and a widget holds a
 * `Reading<VesselOrbit>`. This reaches the first from the second without a
 * switch over the states at every call site, and keeps the `held` state
 * that a hand-written switch most often drops.
 *
 * `select` runs only on the states that HAVE a payload. The other three carry
 * nothing to select from and come through unchanged, so a field of a pending
 * reading is a pending reading rather than an observation of `undefined`.
 *
 * ## It drops the model
 *
 * A {@link Reckoning} is a projection of the declared fields, keyed by their
 * own paths. A selector is an arbitrary function: it may pick a field no model
 * moves, or compute a magnitude out of three that it does. There is no general
 * way to carry a reckoning through one, and carrying it through unchanged would
 * be worse than dropping it, because the result would claim a model for a
 * quantity the model never spoke about.
 *
 * So the return type is an {@link UnmodelledReading}, exactly as
 * {@link withoutReckoning} produces, and for the same reason: a widget that
 * wants the modelled figure branches on `reckoning` itself and hands the
 * projection over as its own `Value`, which is a written choice and shows up in
 * review.
 *
 * @category Reading telemetry
 */
export function readingOf<
  Payload,
  ReckonableKey extends keyof Payload,
  Selected,
>(
  reading: ReckonableReading<Payload, ReckonableKey>,
  select: (payload: Payload) => Selected,
): UnmodelledReading<Selected>;
export function readingOf<Payload, Selected>(
  reading: TopicReading<Payload>,
  select: (payload: Payload) => Selected,
): UnmodelledReading<Selected>;
export function readingOf<Payload, Selected>(
  reading: TopicReading<Payload> | ReckonableReading<Payload, keyof Payload>,
  select: (payload: Payload) => Selected,
): UnmodelledReading<Selected> {
  if (reading.state === "observed") {
    return topicReading({
      state: "observed",
      reckoning: { status: "none" },
      value: select(reading.value),
      atUt: reading.atUt,
    });
  }
  if (reading.state === "held") {
    return topicReading({
      state: "held",
      reckoning: { status: "none" },
      value: select(reading.value),
      asOfUt: reading.asOfUt,
      grade: reading.grade,
    });
  }
  if (reading.state === "absent") {
    return topicReading({
      state: "absent",
      reckoning: { status: "none" },
      atUt: reading.atUt,
    });
  }
  if (reading.state === "pending")
    return topicReading({ state: "pending", reckoning: { status: "none" } });
  return topicReading({ state: "unowned", reckoning: { status: "none" } });
}

/**
 * A figure a widget derives from a topic, as a {@link Reading} of its own: the
 * figure as observed, and the same figure as the topic's model has it at the
 * instant the model ran for.
 *
 * `observed` runs on the observation. `reckoned` runs on the observation
 * overlaid by what the model moved, and is handed the reckoning's own instant,
 * so a figure at the craft's present can only come from a model that ran and
 * always arrives marked as that model's. Where the model declined, the
 * derived reading carries the decline; where it had nothing to say, nothing.
 *
 * Unlike {@link readingOf}, the model survives, because the caller writes the
 * modelled branch itself rather than handing one selector to both.
 *
 * @category Reckoners
 */
// The ReckonableReading overload comes FIRST, for the same reason `withoutReckoning`'s does.
export function deriveReading<
  Payload,
  ReckonableKey extends keyof Payload,
  Derived,
>(
  source: ReckonableReading<Payload, ReckonableKey>,
  observed: (value: Payload) => Derived | undefined,
  reckoned: (modelled: Payload, atUt: Value<"ut">) => Derived | undefined,
): Reading<Derived>;
export function deriveReading<Payload, Derived>(
  source: TopicCurrency<Payload, TopicReckoning<Payload>>,
  observed: (value: Payload) => Derived | undefined,
  reckoned: (modelled: Payload, atUt: Value<"ut">) => Derived | undefined,
): Reading<Derived>;
export function deriveReading<Payload, Derived>(
  source: TopicCurrency<
    Payload,
    TopicReckoning<Payload> | DeclaredTopicReckoning<Partial<Payload>>
  >,
  observed: (value: Payload) => Derived | undefined,
  reckoned: (modelled: Payload, atUt: Value<"ut">) => Derived | undefined,
): Reading<Derived> {
  if (source.state === "pending" || source.state === "unowned") {
    return { state: source.state, reckoning: { status: "none" } };
  }
  if (source.state === "absent") {
    return {
      state: "absent",
      atUt: source.atUt,
      reckoning: { status: "none" },
    };
  }
  const reckoning = derivedReckoning(source.value, source.reckoning, reckoned);
  if (source.state === "observed") {
    return {
      state: "observed",
      value: observed(source.value),
      atUt: source.atUt,
      reckoning,
    };
  }
  return {
    state: "held",
    value: observed(source.value),
    asOfUt: source.asOfUt,
    grade: source.grade,
    reckoning,
  };
}

function derivedReckoning<Payload, Derived>(
  value: Payload,
  reckoning: TopicReckoning<Payload> | DeclaredTopicReckoning<Partial<Payload>>,
  reckoned: (modelled: Payload, atUt: Value<"ut">) => Derived | undefined,
): Reckoning<Derived> {
  if (reckoning.status === "declined") {
    return { status: "declined", declined: reckoning.declined };
  }
  if (reckoning.status === "none") return { status: "none" };
  const modelled = reckoned({ ...value, ...reckoning.value }, reckoning.atUt);
  if (modelled === undefined) return { status: "none" };
  return {
    status: "available",
    modelled,
    atUt: reckoning.atUt,
    beyondReceived: reckoning.beyondReceived,
    basis: reckoning.basis,
  };
}

/**
 * One figure of a derived {@link Reading}, with its model carried through:
 * `pick` runs on the observation and on the modelled value alike, which is
 * sound only because both are the same type.
 *
 * @category Reading telemetry
 */
export function pickReading<Payload, Picked>(
  reading: Reading<Payload>,
  pick: (value: Payload) => Picked | undefined,
): Reading<Picked> {
  const value = reading.value === undefined ? undefined : pick(reading.value);
  const reckoning = pickedReckoning(reading.reckoning, pick);
  return { ...reading, value, reckoning };
}

function pickedReckoning<Payload, Picked>(
  reckoning: Reckoning<Payload>,
  pick: (value: Payload) => Picked | undefined,
): Reckoning<Picked> {
  if (reckoning.status !== "available") return reckoning;
  const modelled = pick(reckoning.modelled);
  if (modelled === undefined) return { status: "none" };
  return {
    status: "available",
    modelled,
    atUt: reckoning.atUt,
    beyondReceived: reckoning.beyondReceived,
    basis: reckoning.basis,
  };
}

/**
 * The {@link ModelledField} that covers `path`, or `undefined` where no entry
 * does.
 *
 * The root entry covers only the root: it says the payload is under the
 * model's claim, and a field no other entry names is a copy of the last
 * observation. A basis inherits from a moved field to the fields inside it,
 * and the most specific claim wins where two apply. A band does not inherit,
 * and {@link fieldReckoning} looks one up at the exact path for that reason: a
 * basis is a property of the model and is true of every path it moves, while
 * a band is two numbers in one quantity's unit, so borrowing a parent's would
 * put a metre interval around a speed.
 */
function coveringField(
  modelled: readonly ModelledField[],
  path: string,
): ModelledField | undefined {
  let best: ModelledField | undefined;
  for (const entry of modelled) {
    const covers =
      entry.path === path ||
      (entry.path !== "" && path.startsWith(`${entry.path}.`));
    if (!covers) continue;
    if (!best || entry.path.length > best.path.length) best = entry;
  }
  return best;
}

/** One dotted step into a payload, or `undefined` where the walk falls off. */
function walkField(payload: unknown, path: string): unknown {
  let current = payload;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * One path's {@link Reckoning}, projected out of the topic's own model.
 *
 * Projected rather than read from the subtopic of the same name, so the field
 * keeps the band the topic's own model produced: it is read out of
 * {@link TopicReckoningAvailable.bands} at this path.
 *
 * A path no {@link ModelledField} covers reckons `"none"`: the value sitting at
 * that path in the modelled payload is a copy of the last observation, carried
 * along because the model returns the whole payload.
 *
 * @category Reading telemetry
 */
export function fieldReckoning(
  reckoning: TopicReckoning<unknown>,
  path: string,
): Reckoning<unknown> {
  if (reckoning.status !== "available") return reckoning;
  const covering = coveringField(reckoning.modelled, path);
  if (!covering) return { status: "none" };
  return {
    status: "available",
    modelled: walkField(reckoning.value, path),
    atUt: reckoning.atUt,
    beyondReceived: reckoning.beyondReceived,
    basis: covering.basis,
    band: reckoning.bands?.[path],
  };
}

/** One payload field's {@link Reading}, at the same currency as its topic. */
function projectField(
  currency: TopicCurrency<unknown, TopicReckoning<unknown>>,
  path: string,
): Reading<unknown> {
  const reckoning = fieldReckoning(currency.reckoning, path);
  switch (currency.state) {
    case "pending":
    case "unowned":
      return { state: currency.state, reckoning };
    case "absent":
      return { state: "absent", atUt: currency.atUt, reckoning };
    case "observed":
      return {
        state: "observed",
        value: walkField(currency.value, path),
        atUt: currency.atUt,
        reckoning,
      };
    case "held":
      return {
        state: "held",
        value: walkField(currency.value, path),
        asOfUt: currency.asOfUt,
        grade: currency.grade,
        reckoning,
      };
  }
}

/**
 * The currency half plus its per-field readings: what a whole-topic read hands
 * a widget.
 *
 * LAZY, through a proxy, because a topic has as many fields as the contract
 * gives it and a widget reads two of them. `vessel.target` flattens to
 * forty-seven, so fields are built on first read. Each is cached on first read,
 * so two reads of one field are one projection and the reading a caller holds
 * keeps its identity.
 *
 * A proxy rather than `Object.defineProperty` over the payload's own keys,
 * because the field half has to be there on `pending`, `unowned` and `absent`
 * too, where there is no payload to enumerate. A widget that reaches
 * `flight.altitudeAsl.state` before the first packet lands must get `"pending"`,
 * not a crash.
 *
 * Spreading one copies the currency and NOT the field readings: `ownKeys` is
 * the currency's, so `{ ...reading }` is what it has always been. Reach a field
 * off the reading itself.
 *
 * @category Reading telemetry
 */
export function topicReading<Payload>(
  currency: TopicCurrency<Payload, { readonly status: "none" }>,
): UnmodelledReading<Payload>;
export function topicReading<Payload>(
  currency: TopicCurrency<Payload, TopicReckoning<Payload>>,
): TopicReading<Payload>;
export function topicReading<Payload>(
  currency: TopicCurrency<Payload, { readonly status: string }>,
): TopicReading<Payload> {
  const cache = new Map<string, Reading<unknown>>();
  return new Proxy(currency, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target)
        return Reflect.get(target, prop, receiver);
      return fieldReading(
        target as TopicCurrency<unknown, TopicReckoning<unknown>>,
        prop,
        cache,
      );
    },
  }) as TopicReading<Payload>;
}

/**
 * One field's reading, itself navigable to the fields under it.
 *
 * The recursion is what makes `crew[kerbal].rules[index].value` reach a band:
 * each step composes the DOTTED path the model already keys its bands by, so
 * the leaf's `reckoning.band` is the entry the reckoner wrote at exactly that
 * string. Nothing parses a path and no consumer writes one.
 *
 * A map key and an array index arrive at the trap identically, as string
 * property names, so `crew.Bill`, `crew["Bill"]` and `rules[0]` are one
 * mechanism rather than three.
 *
 * Cached by FULL path on the topic reading's own map, so two reads of one leaf
 * are one projection and the reading a caller holds keeps its identity across
 * a render. The intermediate steps are cached too, which is what stops a deep
 * read re-walking its own prefix.
 *
 * A property already ON the projected reading wins, which is the currency
 * itself: `.state`, `.value`, `.reckoning` answer about the field, never about
 * a payload member of the same name. That is the reserved-name collision, and
 * it is why the codegen check refuses those spellings.
 */
function fieldReading(
  currency: TopicCurrency<unknown, TopicReckoning<unknown>>,
  path: string,
  cache: Map<string, Reading<unknown>>,
): Reading<unknown> {
  const cached = cache.get(path);
  if (cached) return cached;
  const projected = new Proxy(projectField(currency, path), {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in CURRENCY_MEMBERS)
        return Reflect.get(target, prop, receiver);
      return fieldReading(currency, `${path}.${prop}`, cache);
    },
  });
  cache.set(path, projected);
  return projected;
}

/**
 * The currency's own member names, which a path step may never be.
 *
 * `prop in target` is not enough: a reading's optional members are simply absent
 * in the states that do not carry them, so the guard has to be the NAME, not
 * whether this state happens to carry it.
 *
 * `satisfies Record<ReservedReadingKey, true>` is what keeps this honest: a
 * member added to the type and forgotten here is a compile error, so the type
 * stays the single source and this is checked against it rather than being a
 * second list to keep in step.
 */
const CURRENCY_MEMBERS = {
  state: true,
  value: true,
  atUt: true,
  asOfUt: true,
  grade: true,
  reckoning: true,
} satisfies Record<ReservedReadingKey, true>;

/**
 * A band narrowed to the unit a caller expects, or `undefined` where it is in
 * some other unit or is malformed.
 *
 * {@link ReckonedBands} is keyed by a runtime path string, so nothing in the
 * type system knows what unit the band at `"verticalSpeed"` is in and every
 * consumer would otherwise reach its typed band through a cast. This CHECKS
 * instead: the narrowing is real, and a producer that banded a field in the
 * wrong unit hands the consumer nothing rather than a number it will read as
 * metres per second.
 *
 * Returning `undefined` rather than throwing is the same judgement the rest of
 * this file makes about a bad band: the reckoned value is still good, and a
 * consumer with no band behaves exactly as one whose model offered none.
 *
 * @category Reckoners
 */
export function bandIn<Unit extends string, SourceUnit extends string = string>(
  band: UncertaintyBand<SourceUnit> | undefined,
  unit: Unit,
): UncertaintyBand<Unit> | undefined {
  if (!band || !bandIsWellFormed(band)) return undefined;
  /*
   * NARROWED, not rebuilt and not cast. `isUnit` is a type predicate over the
   * check this function already performed by hand, so the three components
   * come back out as the ones that went in.
   *
   * Three questions rather than one because a predicate narrows the value it
   * is handed and says nothing about its siblings. That reads as redundant
   * against `bandIsWellFormed`, which has already established all three share
   * a unit, and it is not: what it establishes is that they agree with EACH
   * OTHER, and the runtime knows nothing of `Unit`. Asking about each is what
   * lets the three be returned as an `UncertaintyBand<Unit>` with no assertion
   * anywhere.
   */
  if (
    !isUnit(band.value, unit) ||
    !isUnit(band.lo, unit) ||
    !isUnit(band.hi, unit)
  )
    return undefined;
  return { value: band.value, lo: band.lo, hi: band.hi, kind: band.kind };
}

/**
 * Whether a band says something coherent: the ends bracket the value, all
 * three are finite, and all three are in one unit.
 *
 * A producer-facing check rather than a gate. Nothing rejects a malformed band
 * at runtime, because the store cannot tell a model's bug from a model's
 * opinion and refusing the whole reckoning over a bad interval would lose the
 * value too. What this is for is the producer's OWN test: a model that offers
 * a band asserts this over its output, and the store's suite asserts it over
 * every band a built-in model mints.
 *
 * `lo === value === hi` passes. A model claiming it knows a value exactly is
 * making a strong claim, not an ill-formed one, and a quantised or
 * integer-valued quantity is the honest case for it.
 *
 * @category Reckoners
 */
export function bandIsWellFormed<Unit extends string>(
  band: UncertaintyBand<Unit>,
): boolean {
  const { value: v, lo, hi } = band;
  if (lo.unit !== v.unit || hi.unit !== v.unit) return false;
  if (!lo.isFinite() || !v.isFinite() || !hi.isFinite()) return false;
  return lo.lessThanOrEqual(v) && v.lessThanOrEqual(hi);
}

/**
 * Where a band sits relative to a threshold: wholly under it, wholly over it,
 * or across it.
 *
 * The DECISION primitive, and the reason a band is worth carrying at all for a
 * consumer that renders no picture. A widget comparing a bare reckoned number
 * against a limit gets a verdict on every frame and has no way to say the one
 * true thing, which is that the model does not yet know. `"straddles"` is that
 * third result, and a widget that acts on it says so rather than guessing.
 *
 * The boundary is INCLUSIVE at both ends: a band whose `hi` lands exactly on
 * the threshold reads `"below"`, not `"straddles"`. An interval touching a
 * limit has not crossed it, and treating equality as unresolved would make
 * every band that happens to close on a round number unresolvable.
 *
 * Both arguments share `Unit`, so the two units are the same string and compare
 * directly. That is why there is no conversion here and no cast: a mismatch is
 * not representable in the signature.
 *
 * @category Reckoners
 */
export function bandSide<Unit extends string>(
  band: UncertaintyBand<Unit>,
  threshold: Value<Unit>,
): "below" | "above" | "straddles" {
  if (band.hi.lessThanOrEqual(threshold)) return "below";
  if (band.lo.greaterThanOrEqual(threshold)) return "above";
  return "straddles";
}

/**
 * Whether the producer has spoken about this topic at all, whatever it said.
 *
 * The question a presence gate asks. Use it rather than
 * `reading.state !== "pending"`, which reads `unowned` as the producer having
 * reported when it is the strongest evidence that no producer exists.
 *
 * `absent` is deliberately TRUE: a producer saying "there is no value" is still
 * a producer, and a tombstone is data. `held` likewise, since a domain that
 * reported and went quiet is still installed.
 *
 * The two falses are NOT interchangeable even though this collapses them, and a
 * caller that renders something for the user should branch on `state` rather
 * than on this: `pending` may become true on the next frame and `unowned` never
 * will. This says whether the gate should be open, not what to show.
 *
 * Takes the discriminant rather than `Reading<Payload>`, because it reads
 * nothing else and because the callers that need it most cannot supply a
 * `Reading<Payload>`: a presence gate reads `` `${domain}.available` `` through
 * a runtime `as TopicId` cast, so its reading is the union over EVERY topic and
 * unifies with no single `Payload`.
 *
 * @category Reading telemetry
 */
export function hasAnswered(reading: {
  readonly state: ReadingState;
}): boolean {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return false;
    case "absent":
    case "observed":
    case "held":
      return true;
  }
}

/**
 * Returns when the reading's value was observed, or confirmed absent, and
 * `undefined` while `"pending"` or `"unowned"`.
 *
 * For a held value it is when that value was observed. A reading with a
 * forward model returns its last real observation, never the model's instant.
 *
 * An age is `viewUt.minus(observedAt(reading))`, a `Value<"s">`. Clamp it at
 * zero: samples can arrive out of order, so one can sit slightly ahead of the
 * view time.
 *
 * @category Reading telemetry
 */
export function observedAt<Payload>(
  reading: TopicCurrency<Payload>,
): Value<"ut"> | undefined {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return undefined;
    case "absent":
    case "observed":
      return reading.atUt;
    case "held":
      return reading.asOfUt;
  }
}

/**
 * A provider of forward models, consulted once per reading. Returning
 * `undefined` is the usual case and leaves the reading `reckoning: { status:
 * "none" }`; returning a model makes it `"available"`.
 *
 * `TopicModel.reckon` is what makes the reckoning a pull. This function itself
 * must stay cheap: it is asked whether a model EXISTS and what it covers,
 * which are questions about the basis, not requests to run it.
 *
 * `grade` is `undefined` when the reading is LIVE, and a reckoner is asked on
 * live readings deliberately. A model whose basis is a CAUSE (a conic, a rate)
 * is as true of a value that arrived on time as of one that stopped arriving.
 * A reckoner that genuinely integrates FROM the last
 * observation declines where {@link currentAtReckonTime} holds, and says why.
 *
 * `reckonUt` is the third argument because declining is the ONLY way a model has
 * to express a horizon, and a horizon is a statement about how far a value is
 * being carried. Given the point and the grade alone, a reckoner knows when
 * the observation was made and not what it is being asked to reach, so it
 * could not decline at the one moment declining matters. Everything
 * `Reading`'s doc says about `"available"` being the statement of trust rests
 * on this argument existing.
 *
 * @category Reckoners
 */
export type ReckonerFor<Payload> = (
  point: TimelinePoint<Payload>,
  grade: HeldGrade | undefined,
  reckonUt: number,
) => TopicModel<Payload> | undefined;

/**
 * What one declared dependency resolves to when the STORE resolves it for a
 * reckoner.
 *
 * The notation is `Dep`'s, unchanged, because a reckoner's inputs are the same
 * kind of thing a processor's are and inventing a second spelling for them
 * would be two vocabularies to keep in step. What differs is the RESOLUTION: a
 * Topic id resolves to the `TimelinePoint`, not to the bare payload a processor
 * gets.
 *
 * That is not a convenience. A reckoner is a producer at the timeline layer,
 * and it already holds its own point; an input's `meta.quality` is exactly the
 * sort of fact a forward model withdraws on (the conic refuses a craft that is
 * not on rails), and a payload-only resolution would hide it behind an
 * `undefined` the reckoner could not tell from an absent channel.
 */
type ResolvedReckonerDep<Dependency extends Dep> =
  Dependency extends ProcessorHandle<infer Result>
    ? Result
    : Dependency extends ReadingDep<infer Topic>
      ? Reading<TopicPayload<Topic>>
      : /*
         * A subject dep resolves to the same `TimelinePoint | undefined` a plain
         * Topic id does, so a model destructures both the same way and nothing
         * inside it has to know which kind it was handed. The payload comes from
         * the dep's own parameter rather than from `TopicPayload`: the topic is
         * computed per subject, so it has no member in the generated map to look
         * up, exactly as a dynamic `useStream<Payload>` read states its own type.
         */
        Dependency extends SubjectDep<infer Payload>
        ? TimelinePoint<Payload> | undefined
        : Dependency extends TopicId
          ? TimelinePoint<TopicPayload<Dependency>> | undefined
          : never;

/**
 * How much of its OWN topic's record a reckoner is handed, bounded both ways.
 *
 * A model that wants a trend (a rate, a drift, a slope) declares how much of
 * the record it needs.
 *
 * ## The two bounds do different jobs, and only one of them refuses
 *
 * `spanUt` and `maxSamples` are a COST CAP. A window that catches more points
 * than `maxSamples` is thinned to that many and the model runs anyway: the
 * reckoner asked for a lookback, not for every sample inside it, and dropping
 * points from a dense stretch costs a rate estimate nothing.
 *
 * `minSamples` is the SUFFICIENCY FLOOR and the only rejection here. Below it
 * the model never runs and the store returns `declined: { reason:
 * "insufficient-history" }` on its behalf, because a slope taken from one point
 * is not a slope, and a model given one anyway would invent the very confidence
 * {@link Reading} exists to withhold.
 *
 * ## It applies to the reckoner's OWN topic, and to nothing else
 *
 * There is no `minSamples` on {@link DepWindow}, and that is the whole reason
 * the two are separate types rather than one with a flag. A floor applied to
 * dependencies would refuse to model anything whose input is a slow-moving
 * constant, which is most of them: `system.bodies` changes once a session, so a
 * two-sample floor on it would decline forever on a fact that was never
 * missing.
 *
 * ## What a span does NOT mean
 *
 * `spanUt` is game seconds of LOOKBACK from the newest observation, never a
 * count of expected samples. The stream is change-gated, so a topic only
 * carries a point when its value actually changed: "changes every twenty
 * seconds" and "is sampled every twenty seconds" are the same thing in the
 * buffer and different things in the world. Nothing here divides a span by an
 * interval, and nothing written against it should.
 *
 * @category Reckoners
 */
export interface ReckonerWindow {
  /**
   * Lookback in game seconds, measured back from the newest observation the
   * reckoner can see, NOT from the frame's view time. A model carrying a value
   * across a blackout still wants the last minute of contact, and a window
   * anchored on the view time would empty out exactly when the model was
   * needed.
   */
  readonly spanUt: number;
  /** Cost cap: a fuller window is thinned to this many points, ends kept. */
  readonly maxSamples: number;
  /** Sufficiency floor. Below it the model does not run. Defaults to 1. */
  readonly minSamples?: number;
}

/**
 * A window one DEPENDENCY opts into, turning its resolution from a single point
 * into an array.
 *
 * By default a dep still resolves to one point by hold-last, and that is
 * correct rather than a shortcut: a change-gated timeline only carries a point
 * when the value changed, so a dep that last changed an hour ago has not gone
 * missing, its value now IS that value. `sampleDerivedRange` already leans on
 * exactly this to replay a derived channel over its inputs' change points.
 *
 * No `minSamples`: see {@link ReckonerWindow}.
 *
 * @category Reckoners
 */
export interface DepWindow {
  /** As {@link ReckonerWindow.spanUt}, measured back from this dep's own newest point. */
  readonly spanUt: number;
  /** As {@link ReckonerWindow.maxSamples}. */
  readonly maxSamples: number;
  /**
   * Declared as `never` rather than left out, so writing one is an error the
   * compiler gives rather than a key that is quietly ignored. `depWindows` is
   * inferred as a whole object before its constraint is checked, and a
   * constraint check does no excess-property check, so an omitted field would
   * have been accepted here and dropped.
   */
  readonly minSamples?: never;
}

/**
 * The deps a window can be declared for: the Topic ids among them.
 *
 * A `ReadingDep` and a `ProcessorHandle` are excluded because neither is a
 * stored timeline to range over. A reading is one topic's currency AT a view
 * time, and a processor is recomputed per frame and never buffered, so there is
 * no history to hand back for either.
 *
 * @category Reckoners
 */
export type WindowableDep<Deps extends readonly Dep[]> = Extract<
  Deps[number],
  TopicId
>;

/**
 * The opt-in map, keyed by the reckoner's OWN declared deps.
 *
 * Keyed by `WindowableDep<Deps>` rather than by `string` so a window declared
 * for a topic this reckoner does not depend on is a compile error rather than a
 * silently ignored key.
 *
 * @category Reckoners
 */
export type DepWindows<Deps extends readonly Dep[]> = {
  readonly [Dependency in WindowableDep<Deps>]?: DepWindow;
};

/**
 * What one declared dependency resolves to, given which deps opted into a
 * window.
 *
 * `Windowed` is the set of dep ids carrying a {@link DepWindow}, and it is a
 * type parameter rather than a runtime flag so the difference shows up where it
 * matters: a dep that opted in destructures as an ARRAY and one that did not as
 * a single point, with no cast at either call site and no `Array.isArray` check
 * inside a model to find out which it got.
 *
 * @category Reckoners
 */
export type ResolvedReckonerDeps<
  Deps extends readonly Dep[],
  Windowed extends TopicId = never,
> = {
  [Index in keyof Deps]: Deps[Index] extends Dep
    ? Deps[Index] extends Windowed
      ? readonly TimelinePoint<TopicPayload<Extract<Deps[Index], TopicId>>>[]
      : ResolvedReckonerDep<Deps[Index]>
    : never;
};

/**
 * What a reckoner is told about the frame it is running for, beyond its inputs.
 *
 * @category Reckoners
 */
export interface ReckonerFrame<Payload = unknown> {
  /** `undefined` when the reading is LIVE; see {@link ReckonerFor}. */
  readonly grade: HeldGrade | undefined;
  /** The instant the model is being asked to reach: the frame's SCET. */
  readonly reckonUt: number;
  /**
   * The received edge the observation was sampled at. Behind {@link reckonUt}
   * by the light-time, and equal to it when the light-time is too short to see.
   */
  readonly viewUt: number;
  /**
   * The reckoner's own topic across its declared {@link ReckonerWindow},
   * oldest first, the last entry being the same point `reckon` is handed
   * separately.
   *
   * Never empty, and exactly `[point]` when no window is declared: a reckoner
   * that asked for no history is one whose window is a single sample, which is
   * the old behaviour stated as a window rather than a second code path.
   *
   * It stops at the newest break in the record and never spans one. Two things
   * count as a break and both are POSITIVE claims rather than an interval
   * anyone guessed at: a point carrying `meta.gapSinceUt` (the producer saying
   * data existed before it and is gone) and a tombstone (`payload === null`,
   * the value confirmed absent and later back). Samples either side of a
   * blackout are not the same regime, and a model handed both would draw a
   * trend through an outage it has no readings for.
   */
  readonly history: readonly TimelinePoint<Payload>[];
}

/**
 * Whether the observation is live AND asked for the instant it was received at,
 * so there is no gap for a model integrating from the last observation to carry
 * it across. Under signal delay a live observation is still a light-time behind
 * the craft's present, and that is a gap.
 *
 * @category Reading telemetry
 */
export function currentAtReckonTime(frame: ReckonerFrame): boolean {
  return frame.grade === undefined && frame.reckonUt <= frame.viewUt;
}

/**
 * A rule about a model's declared INPUTS that the store applies to every
 * registration, whether or not the model's author knew it existed.
 *
 * Both come from the same statement: a forward model is a claim about the
 * future made out of other people's numbers, and it cannot honestly claim more
 * than those numbers support. A model author writing neither of these gets both,
 * which is the point; a model that genuinely needs to exceed one says so in
 * {@link ReckonerExemptions} and gives the reason.
 *
 * - `horizon`: the model is not offered on a frame where one of its declared
 *   inputs is past ITS OWN model's horizon. There is no horizon FIELD to clamp
 *   (see {@link ReckoningDecline}, and {@link Reading}'s "No horizon field"),
 *   so the rule is spelled the only way a horizon is ever spelled here: the
 *   model withdraws for that frame, declining `"beyond-horizon"` and naming the
 *   input that ran out
 * - `band`: the model's {@link UncertaintyBand}s never claim to know more than
 *   the bands on its inputs do. A `sigma1` input caps the output's kind at
 *   `sigma1`, because a hard bound cannot be derived from an error that was
 *   never bounded; and an input band with width forbids a zero-width output
 *   band, because exactness cannot be derived from uncertainty. A band the rule
 *   rejects is DROPPED rather than widened to an invented number, which is the
 *   same result {@link ReckonedBands} already gives for a model that cannot
 *   bound its own error
 *
 * ## What the band rule deliberately does NOT do
 *
 * It does not compare WIDTHS. A width comparison across an input path and an
 * output path is not sound without knowing the model's sensitivity to that
 * input: an altitude taken from a precise conic and an imprecise body radius is
 * legitimately tighter in metres than either, and averaging independent samples
 * legitimately narrows. So the rule polices the two claims that are wrong
 * whatever the mathematics (a bound out of a sigma, an exact result out of an
 * inexact input) and leaves the arithmetic to the model.
 *
 * @category Reckoners
 */
export type ReckonerInputRule = "horizon" | "band";

/**
 * A model's declared opt-out from an input rule, one key per rule, whose VALUE
 * is the reason its mathematics justifies going beyond.
 *
 * The reason is the value rather than a sibling flag so an opt-out cannot be
 * taken without stating one: there is no spelling of "exempt from the horizon
 * rule" that does not also say why. `registerReckoner` rejects a blank reason
 * for the same purpose, because an empty string is a flag wearing the shape of
 * a sentence.
 *
 * A sound example is the one the rule cannot see from outside: a propagator
 * whose output genuinely outlives an input because that input only SEEDS the
 * integration and is never read again. The seed's own model running out says
 * nothing about how far the integration reaches.
 *
 * Every exemption in the running program is enumerable through
 * `getReckonerExemptions`, so an opt-out is reviewable rather than merely
 * possible: an Uplink's generated page lists its own, and a ledger suite pins
 * the whole set.
 *
 * @category Reckoners
 */
export interface ReckonerExemptions {
  /** Why this model may reach past an input's horizon. */
  readonly horizon?: string;
  /** Why this model's band may claim more than its inputs' bands do. */
  readonly band?: string;
  /**
   * The same opt-outs, but only for the models this registration produces on
   * the named {@link ReckoningBasis}.
   *
   * ## Why a registration may need more than one set
   *
   * A registration is not always one model. `vessel.flight` returns a CONIC
   * above the atmosphere interface and an INTEGRATOR of the observed descent
   * rate below it, chosen by the model itself per sample, and the two have
   * genuinely different reaches: the conic cannot outlive the elements it came
   * from, while the integrator carries a measured rate that already includes
   * whatever the installed aerodynamics did and is precisely the model that
   * takes over where the conic stopped.
   *
   * A registration-wide `horizon` opt-out cannot say that: taking one would
   * unbind the conic too.
   *
   * ## Why by BASIS rather than on the returned model
   *
   * An opt-out attached to the model object would be invisible until the model
   * ran, and `getReckonerExemptions` could not enumerate it: the whole
   * set would stop being reviewable, which is the property the rest of this doc
   * is about. A basis is DECLARED, so the set stays a list somebody can diff.
   *
   * ## Why the reason hangs off an INPUT
   *
   * "The horizon rule does not apply to me" is never a claim a model can
   * honestly make. What it can say is "I do not derive from THIS input", and
   * the two differ exactly where it matters: the air model above is not bounded
   * by `vessel.orbit`, and IS bounded by `system.bodies`, because the
   * atmosphere depth is what tells it which regime it is in. A wholesale
   * opt-out would free it from both and let it run past the point its own
   * boundary is known.
   *
   * Same argument as the reason-string one level up, at the level where it is
   * true: a rule-wide opt-out is a flag wearing the shape of a sentence.
   */
  readonly perBasis?: {
    readonly [basis: string]: {
      /** Why this model does not derive from each named input's own reach. */
      readonly horizon?: { readonly [input: string]: string };
      /** Why this model's band owes nothing to each named input's band. */
      readonly band?: { readonly [input: string]: string };
    };
  };
}

/**
 * A registered forward model, and the published inputs it needs.
 *
 * This is the registration surface: `registerReckoner` takes one of these, and
 * an Uplink reaches it through its client handle. `ReckonerFor` is the shape
 * the store calls internally once the inputs are resolved, and an author never
 * writes one.
 *
 * ## Why the inputs are DECLARED rather than reached for
 *
 * A reckoner that reaches for whatever it likes cannot be told from one whose
 * inputs never arrived: both return nothing, and the caller sees a silent
 * `undefined` on a value the contract PROMISED was carriable. Declaring them
 * buys the honest decline that promise is worth: the store resolves each
 * declared input before the model runs, and an input the contract declared and
 * the frame did not carry produces `declined: { reason: "input-absent", input:
 * "@vessel.orbit" }` naming the contract's own spelling, without the model
 * being run on inputs it does not have.
 *
 * ## What the store enforces, and what it leaves to the model
 *
 * The store declines on behalf of a reckoner for the inputs the CONTRACT
 * declares, because that is exactly the promise a mark makes. A dep declared
 * HERE and not in the contract is the model's own refinement: it resolves to
 * `undefined` and the model decides, which is what lets a conic treat an absent
 * body roster as no evidence of an atmosphere rather than as a reason to blank
 * the reading. Withdrawal takes positive evidence; an absent optional input is
 * not evidence.
 *
 * @category Reckoners
 */
export interface ReckonerDefinition<
  Payload,
  Projection = Payload,
  Deps extends readonly Dep[] = readonly Dep[],
  Windows extends DepWindows<Deps> = Record<never, never>,
> {
  /** Declared inputs, in the same notation a Processor's `deps` uses. */
  readonly deps: Deps;
  /**
   * How much of this topic's own record to hand the model, and the floor below
   * which it should not run at all. Omitted means one point: see
   * {@link ReckonerWindow} for why the bounds are shaped the way they are.
   */
  readonly window?: ReckonerWindow;
  /**
   * The deps that want their own history rather than one hold-last point,
   * each with its own span and cap. Keyed by the ids in `deps`.
   */
  readonly depWindows?: Windows;
  /**
   * The {@link ReckonerInputRule}s this model does not obey, each with the
   * reason its mathematics justifies it. Omitted, which is the normal case,
   * means the store applies both.
   */
  readonly exempt?: ReckonerExemptions;
  /**
   * Offer a model for `point` at `frame.viewUt`, or decline and say why. Cheap:
   * it is asked whether a model exists and what it covers.
   */
  reckon(
    point: TimelinePoint<Payload>,
    resolved: ResolvedReckonerDeps<Deps, Extract<keyof Windows, TopicId>>,
    frame: ReckonerFrame<Payload>,
  ): ReckonerAnswer<Payload, Projection>;
}

/**
 * A reckoner definition as the registry holds one, with its type parameters
 * erased to what a caller holding only a topic string can still say.
 *
 * Written out rather than spelled `ReckonerDefinition<unknown, unknown, ...>`
 * because the erasure IS the point: `reckon` is declared here with the argument
 * types the store passes and the result type it reads back, so a definition
 * written against a concrete Topic reaches this shape by method bivariance and
 * the store calls it without an assertion in either direction.
 *
 * @category Reckoners
 */
export interface AnyReckonerDefinition {
  /** Declared inputs, in the same notation a Processor's `deps` uses. */
  readonly deps: readonly Dep[];
  /** See {@link ReckonerDefinition.window}. */
  readonly window?: ReckonerWindow;
  /**
   * See {@link ReckonerDefinition.depWindows}. Erased to a string key here
   * for the same reason the rest of this interface is: the store looks a
   * window up by the dep it is already iterating, and holds no `Deps` to key
   * against.
   */
  readonly depWindows?: { readonly [dep: string]: DepWindow | undefined };
  /** See {@link ReckonerDefinition.exempt}. */
  readonly exempt?: ReckonerExemptions;
  /** See {@link ReckonerDefinition.reckon}; the store resolves `deps` in order. */
  reckon(
    point: TimelinePoint<unknown>,
    resolved: readonly unknown[],
    frame: ReckonerFrame<unknown>,
  ): ReckonerAnswer<unknown, unknown>;
}
