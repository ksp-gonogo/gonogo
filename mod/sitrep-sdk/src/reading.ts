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

/*
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
 * Which kind of forward model produced a reckoning, and so when it stops
 * holding:
 *
 * - `kepler-propagation`: an orbit carried forward under two-body gravity.
 *   Holds until a burn, a change of sphere of influence, or a force the model
 *   leaves out
 * - `linear-dead-reckoning`: a position carried forward at its last observed
 *   velocity. Holds for seconds where the motion curves, such as two craft in
 *   orbit, and longer where it does not
 * - `powered-integration`: a craft under thrust, carried forward under gravity
 *   and its observed thrust along its last observed direction, its mass falling
 *   at its published mass flow. Holds until a command reaches the craft, the
 *   stage runs dry, or the model's uncertainty grows too large
 * - `rate-integration`: a quantity carried forward at its last observed rate of
 *   change. Holds while the rate does, which for a resource means until
 *   something switches a converter, a light or a crew member
 * - `combination`: arithmetic over several readings at one view time, as
 *   {@link combineReadings} does. Nothing is carried forward by this step
 *   itself, so it holds exactly as far as each input's own model does
 *
 * @category Reckoners
 */
export type ReckoningBasis =
  | "combination"
  | "kepler-propagation"
  | "linear-dead-reckoning"
  | "powered-integration"
  | "rate-integration";

/**
 * A forward model's value for a whole Topic: what the model says the payload is
 * at the craft's present, carried forward from the last real observation.
 *
 * `atUt` is the instant the value is for. The reading's own `atUt` or `asOfUt`
 * is when the observation behind it was made.
 *
 * @typeParam Payload - The Topic's payload type.
 *
 * @category Reckoners
 */
export interface TopicReckoningAvailable<Payload> {
  /** Always `"available"`, as on a field's {@link Reckoning}. */
  readonly status: "available";
  /** The modelled payload. Only the paths in `modelled` were moved; the rest is the last observation. */
  value: Payload;
  /** The instant `value` is for: the craft's present, under signal delay. */
  atUt: Value<"ut">;
  /**
   * Whether `atUt` is noticeably later than the newest data received: `true`
   * under signal delay, where the model carries a current reading across the
   * delay, and `false` on a local session. A figure drawn from a reckoning
   * where this is `true` is modelled, not observed, whatever the reading's
   * state.
   */
  beyondReceived: boolean;
  /** The model that produced the payload root. Each moved path has its own in `modelled`. */
  basis: ReckoningBasis;
  /**
   * The paths inside `value` the model moved, each with the model that moved
   * it, dotted from the payload root. Everything else in `value` is the last
   * observation, unchanged: a model of a target's relative position leaves the
   * target's name as it was.
   */
  modelled: readonly ModelledField[];
  /** Who registered the model: `"core"` for Gonogo's own, otherwise the Uplink's id. */
  owner: string;
  /**
   * How well the model knows each moved value, keyed by the same paths as
   * `modelled`, where the model gives a band at all. Absent from most
   * reckonings. See {@link ReckonedBands}.
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
 * The reckoning of a Topic whose contract declares a forward model: the model
 * produced a value, or declined and said why. Never `"none"`.
 *
 * @typeParam Payload - The Topic's payload type.
 *
 * @category Reckoners
 */
export type DeclaredTopicReckoning<Payload> = Exclude<
  TopicReckoning<Payload>,
  { readonly status: "none" }
>;

/**
 * One path a model moved, and which model moved it. See
 * {@link TopicReckoningAvailable.modelled}.
 *
 * @category Reckoners
 */
export interface ModelledField {
  /** Dotted from the payload root. `""` is the whole payload. */
  readonly path: string;
  /** The model that moved it. */
  readonly basis: ReckoningBasis;
}

/**
 * What an {@link UncertaintyBand}'s two ends mean:
 *
 * - `bound`: the true value is certainly between `lo` and `hi`
 * - `sigma1`: one standard deviation either side of `value`. The true value is
 *   outside it about a third of the time, so do not draw or describe it as a
 *   limit
 *
 * @category Reckoners
 */
export type BandKind = "bound" | "sigma1";

/**
 * How well a model knows a value it produced: a low end and a high end, in the
 * value's own unit, either side of the model's estimate.
 *
 * The two ends are given separately because the error is often larger on one
 * side, such as an altitude near periapsis. They are in the unit, never a
 * percentage, so a band around a value crossing zero, such as a vertical speed
 * at apoapsis, keeps its width.
 *
 * `value` is the same number as the reckoning's modelled value at that path, so
 * a band can be passed alone to a threshold check or a chart. Use
 * {@link bandIn} to read a band in a known unit, and {@link bandSide} to
 * compare one with a threshold.
 *
 * @typeParam Unit - The unit of all three values.
 *
 * @category Reckoners
 */
export interface UncertaintyBand<Unit extends string = string> {
  /** The model's estimate: the same value the reckoning carries at this path. */
  readonly value: Value<Unit>;
  /** The low end. Never above `value`. */
  readonly lo: Value<Unit>;
  /** The high end. Never below `value`. */
  readonly hi: Value<Unit>;
  /** Whether the ends are a hard bound or one standard deviation. */
  readonly kind: BandKind;
}

/**
 * The bands a model gives for one frame, keyed by the same dotted paths as
 * {@link ModelledField.path}, with `""` for the payload root.
 *
 * Most models give no band, and return `undefined` rather than an empty
 * object. A missing band means the model does not say how well it knows the
 * value, not that it knows it well.
 *
 * @category Reckoners
 */
export type ReckonedBands = {
  readonly [path: string]: UncertaintyBand | undefined;
};

/**
 * A forward model a reckoner offers: the paths it moves, and the functions
 * that compute the modelled value and its bands for a given instant. The model
 * runs only when a reading actually needs its value.
 *
 * A model that does not move the payload root does not count for a read of the
 * whole Topic, so that read stays `"held"`.
 *
 * @typeParam Payload - The Topic's payload type.
 * @typeParam Projection - What `reckon` returns: the whole payload, or for a
 * Topic declaring a model on some fields only, just those fields.
 *
 * @category Reckoners
 */
// Coverage sits outside the thunk so the store can choose a reading without running the model.
export interface TopicModel<Payload, Projection = Payload> {
  /** Paths this model moves. Empty claims nothing and is never offered. */
  readonly modelled: readonly ModelledField[];
  /** Run the model for `viewUt`. Pure: same inputs, same result. */
  reckon(viewUt: number): Projection;
  /**
   * Returns how well the model knows its result for `viewUt`, by path, or
   * `undefined` for a model that cannot bound its own error. Called only after
   * `reckon`, with the same `viewUt`, so the two may share work. The same
   * inputs must give the same result.
   */
  bandAt?(viewUt: number): ReckonedBands | undefined;
}

/**
 * Why a declared forward model produced no value this frame, by `reason`:
 *
 * - `input-absent`: an input the model needs has not arrived. `input` names it
 * - `beyond-horizon`: the model would have to reach past where it holds, its
 *   own or an input's. `input` names the input that ran out, where one did
 * - `model-inapplicable`: the model does not apply to this frame, such as an
 *   orbit model past a change of sphere of influence
 * - `under-physics`: the craft is being moved by the game's full physics, such
 *   as under thrust, so a closed-form model of its motion does not apply. The
 *   orbit exists and the craft is loaded
 * - `contested`: more than one Uplink registered a model for the Topic and
 *   Gonogo has none of its own to fall back on, so none is used
 * - `insufficient-history`: the model needs more past samples of its own Topic
 *   than its {@link ReckonerWindow} holds. `note` says how many were found
 *
 * Branch on `reason`, never on `input` or `note`.
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
  /** The input responsible, spelled as the contract declares it, such as `"@vessel.orbit"`. Absent where the reason has none. */
  readonly input?: string;
  /** One sentence to show the player. Its wording can change, so never branch on it. */
  readonly note?: string;
}

/**
 * What a reckoner's `reckon` returns: a {@link TopicModel}, or `{ declined }`
 * with the {@link ReckoningDecline} saying why there is none.
 *
 * @typeParam Payload - The Topic's payload type.
 * @typeParam Projection - What the model's `reckon` returns. See
 * {@link TopicModel}.
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
 * | `state` | Meaning | Carries |
 * | --- | --- | --- |
 * | `"pending"` | Nothing has arrived yet: a Topic just subscribed, or a resync after a rewind | nothing |
 * | `"unowned"` | Nothing will ever publish this Topic: no installed Uplink declares it | nothing |
 * | `"absent"` | The game confirmed there is no value, such as no target set | `atUt` |
 * | `"observed"` | The newest value that could have reached us | `value`, `atUt` |
 * | `"held"` | Updates stopped arriving, so this is the last value received | `value`, `asOfUt`, `grade` |
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
 * - `loading`: the game is loading a scene, which affects every Topic at once.
 *   The value is the last one received and nothing says whether it still holds
 * - `no-game`: the game is at its main menu, so there is nothing to read.
 *   The value is the last one received, from a game that is no longer running
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
  | "recorded"
  | "loading"
  | "no-game";

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
 * Returns a reading of one part of a payload, in the same state as the reading
 * it came from: `readingOf(orbit, (o) => o.apoapsis)` is a held reading
 * when `orbit` is held.
 *
 * `select` runs only in the states that carry a value. A `"pending"`,
 * `"unowned"` or `"absent"` reading comes back in the same state.
 *
 * The result has no forward model (`reckoning` is `{ status: "none" }`), since
 * `select` can compute something the model never moved. To show a modelled
 * figure, read `reckoning` on the source reading, or use {@link deriveReading}.
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
 * Returns a figure computed from a Topic reading as a {@link Reading} of its
 * own, keeping the Topic's forward model.
 *
 * `observed` computes the figure from the observed payload. `reckoned` computes
 * it from the modelled payload, and is given the instant the model is for. When
 * the model declined, the result carries the decline; when it had nothing to
 * say, the result has no model. Unlike {@link readingOf}, which drops the
 * model, the caller writes the modelled computation itself.
 *
 * @category Reckoners
 */
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

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/**
 * What the model moved, laid over the observation it moved it from. A record
 * payload takes the moved fields over the rest; an array or a bare value has no
 * fields to merge, so the model's answer is the whole payload.
 */
function overlayModelled<Payload>(
  observed: Payload,
  moved: Partial<Payload>,
): Payload {
  if (isRecord(observed) && isRecord(moved)) {
    return { ...observed, ...moved };
  }
  return moved as Payload;
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
  const modelled = reckoned(
    overlayModelled(value, reckoning.value),
    reckoning.atUt,
  );
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
 * Returns one figure of a {@link Reading}, with its forward model kept: `pick`
 * runs on the observed value and on the modelled value alike. Where `pick`
 * returns `undefined` for the modelled value, the result has no model.
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
 * Returns the {@link Reckoning} of one field of a Topic, taken from the Topic's
 * own model: the modelled value at `path`, the basis that moved it, and the
 * band the model gives at exactly that path.
 *
 * `path` is dotted from the payload root, such as `"verticalSpeed"`. A path the
 * model does not move returns `{ status: "none" }`, since the value there is
 * the last observation copied unchanged. A Topic reckoning that is `"none"` or
 * `"declined"` is returned as it is.
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

/**
 * One payload field's {@link Reading}, at the same currency as its topic.
 *
 * Carries the observed value and, in `reckoning`, the modelled value and band
 * at the same path. A path the payload holds no value at, because the wire left
 * it out or sent null, reads `"absent"`: an observation always carries a value.
 */
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
    case "held": {
      const carried = walkField(currency.value, path);
      if (carried === undefined || carried === null) {
        return {
          state: "absent",
          atUt: currency.state === "observed" ? currency.atUt : currency.asOfUt,
          reckoning,
        };
      }
      return currency.state === "observed"
        ? { state: "observed", value: carried, atUt: currency.atUt, reckoning }
        : {
            state: "held",
            value: carried,
            asOfUt: currency.asOfUt,
            grade: currency.grade,
            reckoning,
          };
    }
  }
}

/**
 * The reading of the first element of a list that satisfies `predicate`, or
 * `undefined` where the list holds no value or no element matches.
 *
 * Use it to find one element by a test and still read its fields as readings,
 * in the list's state and with their forward model.
 *
 * @example
 * ```tsx
 * function NodeCost({ nodeId }: { nodeId: string }) {
 *   const career = useTelemetry("career.status");
 *   const node = findReading(career.tech.nodes, (n) => n.id === nodeId);
 *   return node === undefined ? null : <Unit value={node.scienceCost} />;
 * }
 * ```
 *
 * @typeParam Element - The list's element type.
 *
 * @category Reading telemetry
 */
export function findReading<Element>(
  list: {
    readonly value?: readonly Element[];
    readonly [index: number]: FieldReading<Element>;
  },
  predicate: (element: Element) => boolean,
): FieldReading<Element> | undefined {
  const index = list.value?.findIndex(predicate) ?? -1;
  return index === -1 ? undefined : list[index];
}

/**
 * Builds a {@link TopicReading} from a {@link TopicCurrency}, adding a field
 * reading for every payload field.
 *
 * Field readings exist in every state, so `flight.altitudeAsl.state` is
 * `"pending"` before anything has arrived. Each is built when first read and
 * the same object is returned on every later read.
 *
 * Spreading the result (`{ ...reading }`) copies only the currency, not the
 * field readings. Read a field off the reading itself.
 *
 * @category Reading telemetry
 */
// A proxy rather than defineProperty over the payload's keys: pending, unowned and absent have no payload to enumerate.
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
      if (
        typeof prop !== "string" ||
        prop in target ||
        prop in CURRENCY_MEMBERS
      )
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
 * Returns `band` as a band in `unit`, or `undefined` when it is in another
 * unit or not well formed (see {@link bandIsWellFormed}). Use it to read a band
 * from {@link ReckonedBands}, whose type cannot say what unit each path is in,
 * without a cast. A missing band and a rejected one are the same to the
 * caller: the modelled value still stands.
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
 * Returns whether a band is consistent: all three values finite and in one
 * unit, with `lo` at or below `value` and `hi` at or above it. A band whose
 * three values are equal passes.
 *
 * Nothing rejects a malformed band at runtime. Assert this over your own
 * model's bands in its tests.
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
 * Returns where a band lies against a threshold: `"below"`, `"above"`, or
 * `"straddles"` when the threshold is inside it. `"straddles"` means the model
 * cannot yet say which side the value is on, and a widget should say so rather
 * than pick one.
 *
 * The ends count as outside: a band whose `hi` equals the threshold is
 * `"below"`.
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
 * Returns whether anything has published this Topic yet: `true` for
 * `"absent"`, `"observed"` and `"held"`, `false` for `"pending"` and
 * `"unowned"`.
 *
 * Use it to decide whether to show a section at all, such as one that depends
 * on a mod being installed. `"absent"` counts, because the game said there is
 * no value. Checking `state !== "pending"` instead would count `"unowned"`,
 * which means nothing will ever publish the Topic.
 *
 * To decide what to draw, branch on `state`: `"pending"` can change on the next
 * frame and `"unowned"` never will.
 *
 * It takes any object with a `state`, so a reading of a Topic whose id is
 * built at runtime can be passed.
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
 * The function Gonogo calls on a registered reckoner for each reading, once
 * its inputs are resolved. You write a {@link ReckonerDefinition}, not one of
 * these.
 *
 * It returns `undefined` when there is no model, which leaves the reading's
 * `reckoning` `{ status: "none" }`, or a {@link TopicModel}. It must be cheap: it
 * says whether a model exists and what it covers, and `TopicModel.reckon` does
 * the work.
 *
 * `grade` is `undefined` while the reading is live: a model may be offered for
 * a live reading too. `reckonUt` is the instant the model is asked to reach, so
 * a reckoner can decline past its horizon.
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
 * How many past samples of its own Topic a reckoner is given, for a model that
 * needs a trend such as a rate of change.
 *
 * `spanUt` and `maxSamples` limit the cost: a window with more samples than
 * `maxSamples` is thinned to that many, keeping the first and last, and the
 * model still runs. `minSamples` is the only limit that stops the model: with
 * fewer samples, the reading declines with `"insufficient-history"`.
 *
 * The Topic only gets a new sample when its value changes, so a span of 60
 * seconds may hold one sample or hundreds.
 *
 * Dependencies take a {@link DepWindow} instead, which has no `minSamples`.
 *
 * @category Reckoners
 */
export interface ReckonerWindow {
  /**
   * How far back to look, in game seconds, from the newest sample received
   * rather than from the view time, so a model carrying a value across a loss
   * of signal still gets the samples from before it.
   */
  readonly spanUt: number;
  /** The most samples to pass; more are thinned to this many, keeping the first and last. */
  readonly maxSamples: number;
  /** The fewest samples the model can run with. Defaults to 1. */
  readonly minSamples?: number;
}

/**
 * A window of past samples for one of a reckoner's dependencies, which is then
 * resolved to an array of samples rather than the latest one.
 *
 * Without one, a dependency resolves to its latest sample, however old: a
 * Topic only gets a new sample when its value changes, so an old sample is
 * still the current value.
 *
 * There is no `minSamples`: a slow-changing dependency would otherwise never
 * have enough. See {@link ReckonerWindow}.
 *
 * @category Reckoners
 */
export interface DepWindow {
  /** How far back to look, in game seconds, from this dependency's newest sample. */
  readonly spanUt: number;
  /** The most samples to pass. See {@link ReckonerWindow.maxSamples}. */
  readonly maxSamples: number;
  /** Not allowed on a dependency; setting it does not compile. */
  readonly minSamples?: never;
}

/**
 * The dependencies a {@link DepWindow} can be given: the Topic ids among a
 * reckoner's `deps`. A reading dependency and a processor have no stored
 * history, so they cannot have one.
 *
 * @category Reckoners
 */
export type WindowableDep<Deps extends readonly Dep[]> = Extract<
  Deps[number],
  TopicId
>;

/**
 * The windows a reckoner gives its dependencies, keyed by Topic id. A key that
 * is not one of the reckoner's own `deps` does not compile.
 *
 * @category Reckoners
 */
export type DepWindows<Deps extends readonly Dep[]> = {
  readonly [Dependency in WindowableDep<Deps>]?: DepWindow;
};

/**
 * The resolved values of a reckoner's `deps`, in order, as `reckon` receives
 * them: a Topic id resolves to its latest sample, or to an array of samples if
 * it has a {@link DepWindow}; a reading dependency to its {@link Reading}; a
 * processor to its result.
 *
 * @typeParam Deps - The reckoner's `deps`.
 * @typeParam Windowed - The Topic ids among them that have a window.
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
 * What a reckoner's `reckon` is told about the frame it is running for,
 * beyond its inputs.
 *
 * @category Reckoners
 */
export interface ReckonerFrame<Payload = unknown> {
  /** Why the reading is held, or `undefined` while it is live. */
  readonly grade: HeldGrade | undefined;
  /** The instant the model is asked to reach: the craft's present. */
  readonly reckonUt: number;
  /** The latest instant data has been received for: `reckonUt` minus the signal delay, or equal to it with no noticeable delay. */
  readonly viewUt: number;
  /**
   * The reckoner's own Topic across its {@link ReckonerWindow}, oldest first,
   * ending with the same sample `reckon` is given. Never empty, and just that
   * sample when no window is declared.
   *
   * It never reaches back past a break in the record: a sample marked with
   * `meta.gapSinceUt`, or a value that was confirmed absent. So a trend is
   * never drawn across a loss of signal.
   */
  readonly history: readonly TimelinePoint<Payload>[];
}

/**
 * Returns whether a reckoner is asked for the same instant its observation was
 * received at, with the observation still live, so there is no gap to carry
 * the value across. Under signal delay it is `false`: a live observation is
 * still the signal delay behind the craft.
 *
 * @category Reading telemetry
 */
export function currentAtReckonTime(frame: ReckonerFrame): boolean {
  return frame.grade === undefined && frame.reckonUt <= frame.viewUt;
}

/**
 * A rule Gonogo applies to every forward model's inputs, unless the model
 * declares an exemption in {@link ReckonerExemptions}:
 *
 * - `horizon`: the model is not offered on a frame where one of its inputs is
 *   past its own model's horizon. The reading declines with
 *   `"beyond-horizon"`, naming that input
 * - `band`: the model's {@link UncertaintyBand}s may not claim more than its
 *   inputs' bands. An input band of kind `sigma1` limits the output to
 *   `sigma1`, and an input band with width forbids an output band of zero
 *   width. A band that breaks the rule is dropped, not widened
 *
 * The band rule does not compare widths: a model may legitimately produce a
 * narrower band than its inputs.
 *
 * @category Reckoners
 */
export type ReckonerInputRule = "horizon" | "band";

/**
 * The {@link ReckonerInputRule}s a model does not follow, each with the reason
 * its mathematics allows it. The reason is required and may not be blank. For
 * example, a model that uses an input only to start an integration is not
 * bound by that input's horizon.
 *
 * Every exemption registered can be listed with `getReckonerExemptions`, and an
 * Uplink's generated page shows its own.
 *
 * @category Reckoners
 */
export interface ReckonerExemptions {
  /** Why this model may reach past an input's horizon. */
  readonly horizon?: string;
  /** Why this model's band may claim more than its inputs' bands do. */
  readonly band?: string;
  /**
   * Exemptions that apply only to the models this reckoner produces with one
   * {@link ReckoningBasis}, each from named inputs only. Use it when one
   * reckoner offers different models: `vessel.flight` uses an orbit model above
   * the atmosphere and integrates the observed descent rate below it, and only
   * the second may outlive `vessel.orbit`, while both stay bound by
   * `system.bodies`.
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
 * A forward model to register with `registerReckoner`, or through an Uplink's
 * client handle: the inputs it needs, and the function that offers a model for
 * each reading.
 *
 * Gonogo resolves every input in `deps` before `reckon` runs. When an input the
 * Topic's contract declares has not arrived, the reading declines with
 * `"input-absent"`, naming it, and `reckon` is not called. An input in `deps`
 * that the contract does not declare resolves to `undefined` instead, and the
 * model decides what that means.
 *
 * @typeParam Payload - The Topic's payload type.
 * @typeParam Projection - What the model returns. See {@link TopicModel}.
 * @typeParam Deps - The declared inputs.
 * @typeParam Windows - The {@link DepWindows} given to them.
 *
 * @category Reckoners
 */
export interface ReckonerDefinition<
  Payload,
  Projection = Payload,
  Deps extends readonly Dep[] = readonly Dep[],
  Windows extends DepWindows<Deps> = Record<never, never>,
> {
  /** The inputs the model needs, written as a Processor's `deps` are. */
  readonly deps: Deps;
  /** How many past samples of this Topic the model is given. Omitted, it gets the latest only. */
  readonly window?: ReckonerWindow;
  /** Windows of past samples for some of `deps`, keyed by their Topic ids. */
  readonly depWindows?: Windows;
  /** The input rules this model is exempt from, each with its reason. Usually omitted, so both rules apply. */
  readonly exempt?: ReckonerExemptions;
  /**
   * Returns a {@link TopicModel} for `point`, the latest sample of the Topic,
   * or declines and says why. Keep it cheap: the model's own `reckon` does the
   * computing.
   */
  reckon(
    point: TimelinePoint<Payload>,
    resolved: ResolvedReckonerDeps<Deps, Extract<keyof Windows, TopicId>>,
    frame: ReckonerFrame<Payload>,
  ): ReckonerAnswer<Payload, Projection>;
}

/**
 * A {@link ReckonerDefinition} with its types erased, as the registry holds
 * it. Any definition can be passed where this is expected.
 *
 * @category Reckoners
 */
export interface AnyReckonerDefinition {
  /** See {@link ReckonerDefinition.deps}. */
  readonly deps: readonly Dep[];
  /** See {@link ReckonerDefinition.window}. */
  readonly window?: ReckonerWindow;
  /** See {@link ReckonerDefinition.depWindows}. */
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
