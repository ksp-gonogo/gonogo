/**
 * The number to draw, and the statement the reading makes about it.
 *
 * Shared by every primitive that draws a figure, so a `Reading` cannot mean one
 * thing on a readout and another on the instrument beside it.
 */
import {
  isDeterministicValue,
  isStaticValue,
  type Reading,
  type UncertaintyBand,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "./NullValue";
import type { ReckoningKind } from "./reckoningMarkSpec";
import { heldWord } from "./status/streamStatusWord";
import { formatQuantity } from "./units";

/**
 * What a figure prop accepts: the quantity on its own, or the whole `Reading`
 * it arrived in.
 *
 * One type across every primitive that draws a figure, so a call site holding
 * a reading can fill a readout, a bar and an instrument with the same thing.
 *
 * @category Unit
 */
export type UnitValue<Unit extends string = string> =
  | Value<Unit>
  | Reading<Value<Unit>>;

/**
 * What {@link resolveCurrency} returns: the number to draw, and whether it is current.
 *
 * @category Unit
 */
export interface Resolved<Unit extends string> {
  /** The number to draw; null or undefined draws the null token. */
  shown: Value<Unit> | null | undefined;
  /** True when the number on screen is not a reading of now, so it takes a mark: `mark` says which. */
  held: boolean;
  /**
   * Which mark the figure takes: `held` for the last observation kept, `modelled`
   * for a figure a model carried. Null exactly when `held` is false.
   */
  mark: ReckoningKind | null;
  /**
   * Whether the number is a fact the contract declares static, which is never
   * old and so is never marked held, whatever the reading's state.
   */
  isStatic: boolean;
  /**
   * Whether the number is exact at any instant: computed from fixed inputs and
   * the clock, as a figure between two bodies on fixed conics is. It moves, so
   * it is not static, and it is never a guess, so it takes no held or modelled
   * mark whatever the reading's state.
   */
  isDeterministic: boolean;
  /**
   * What the mark means in words: the grade where the reading names one, a
   * grade-neutral word where it does not, and the instant the number was last
   * a reading of now where that is readable. Said rather than shown, and null
   * only where nothing was marked.
   */
  caption: string | null;
  /**
   * The uncertainty band the reading's model publishes, as it arrived and not
   * yet narrowed to a unit; only a band in the shown value's unit applies.
   */
  band: UncertaintyBand | null;
}

/**
 * When the observation was made, on the game's own calendar, or null when the
 * reading carries no readable instant.
 *
 * Through `formatQuantity`, so a held number and a `<MissionDate>` beside it
 * print one spelling of a UT. A malformed instant answers null, since "as of"
 * followed by the null token is worse than the grade on its own.
 */
function lastValidAt(asOfUt: Value<"ut"> | undefined): string | null {
  if (asOfUt === undefined) return null;
  const { value } = formatQuantity(asOfUt.magnitude, asOfUt.unit);
  return value === NULL_DISPLAY ? null : value;
}

/**
 * What the mark says in words: the grade, and how far back the number is from.
 * The dot answers at a glance; this answers the follow-up in the hover and the
 * accessibility tree.
 */
function sayCurrency(caption: string, asOfUt: Value<"ut"> | undefined): string {
  const at = lastValidAt(asOfUt);
  return at === null ? caption : `${caption}, as of ${at}`;
}

/**
 * How a primitive reads a {@link Reading}.
 *
 * @category Unit
 */
export interface CurrencyOptions {
  /**
   * The consumer draws the reading's reckoning, where one is on offer, rather
   * than its observation: a countdown, or a figure a widget solves forward.
   * The modelled figure is then marked wherever it is not a reading of now,
   * which under signal delay includes a current reading carried to SCET.
   */
  readonly drawsReckoning?: boolean;
}

/**
 * The mark's words for a current reading whose figure the model carried across the light-time.
 *
 * @category Unit
 */
export const MODELLED_TO_SCET = "modelled to SCET";

/**
 * What the model says a current reading's figure is at the instant it reckoned
 * to, where that is past the received edge: the figure a widget draws beside
 * the observation with {@link ModelledAlongside}. `undefined` everywhere else.
 *
 * @category Unit
 */
export function modelledBeyondReceived<Payload>(
  reading: Reading<Payload> | null | undefined,
): Payload | undefined {
  if (reading == null || reading.state !== "observed") return undefined;
  if (reading.value === undefined) return undefined;
  if (reading.reckoning.status !== "available") return undefined;
  if (!reading.reckoning.beyondReceived) return undefined;
  return reading.reckoning.modelled;
}

/** The mark and its words for a held reading's observation. */
function heldCurrency<Unit extends string>(
  input: Reading<Value<Unit>>,
): Omit<Resolved<Unit>, "band"> {
  /*
   * The mark follows the number, not the state: a held reading with no value
   * gets no dot. Whatever is marked gets words, including the ordinary
   * gradeless held reading a derived value produces.
   */
  if (isStaticValue(input.value) || isDeterministicValue(input.value)) {
    return {
      shown: input.value,
      held: false,
      mark: null,
      isStatic: isStaticValue(input.value),
      isDeterministic: isDeterministicValue(input.value),
      caption: null,
    };
  }
  return {
    shown: input.value,
    held: input.value !== undefined,
    mark: input.value !== undefined ? "held" : null,
    isStatic: false,
    isDeterministic: false,
    caption:
      input.value === undefined
        ? null
        : sayCurrency(heldWord(input.grade), input.asOfUt),
  };
}

/**
 * Split what was handed in into the number and the statement about it.
 *
 * A bare `Value` (and `null`, and nothing at all) is current by construction.
 * A `Reading` in `observed` state is current, one in `held` state with a value
 * is marked held, and any other state yields `shown: null`. With
 * `drawsReckoning`, the reading's modelled figure is shown in place of the
 * observation where the model has one.
 *
 * @category Unit
 */
export function resolveCurrency<Unit extends string>(
  input: UnitValue<Unit> | null | undefined,
  options: CurrencyOptions = {},
): Resolved<Unit> {
  // `in` throws on a primitive, and some callers hand over a raw magnitude.
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return {
      shown: input,
      held: false,
      mark: null,
      isStatic: isStaticValue(input),
      isDeterministic: isDeterministicValue(input),
      caption: null,
      band: null,
    };
  }
  // The band is orthogonal to the state: a live reading and a held one may each carry a model.
  const band =
    input.reckoning.status === "available"
      ? (input.reckoning.band ?? null)
      : null;
  if (
    options.drawsReckoning &&
    input.reckoning.status === "available" &&
    (input.state === "observed" || input.state === "held") &&
    // An exact figure needs no model to carry it, so it is never drawn as one.
    !isDeterministicValue(input.value)
  ) {
    const shown = input.reckoning.modelled;
    if (input.state === "held") {
      const held = heldCurrency(input);
      // The figure drawn is the model's, so it is marked as modelled, from the instant the observation stopped.
      return {
        ...held,
        shown,
        mark: held.held ? "modelled" : null,
        caption: held.caption === null ? null : `${held.caption}, modelled`,
        band,
      };
    }
    const carried = input.reckoning.beyondReceived;
    return {
      shown,
      held: carried,
      mark: carried ? "modelled" : null,
      isStatic: false,
      isDeterministic: false,
      caption: carried ? MODELLED_TO_SCET : null,
      band,
    };
  }
  if (input.state === "observed") {
    return {
      shown: input.value,
      held: false,
      mark: null,
      isStatic: isStaticValue(input.value),
      isDeterministic: isDeterministicValue(input.value),
      caption: null,
      band,
    };
  }
  if (input.state === "held") return { ...heldCurrency(input), band };
  // `null` rather than `undefined`, so the caller renders the null token rather than the symbol form.
  return {
    shown: null,
    held: false,
    mark: null,
    isStatic: false,
    isDeterministic: false,
    caption: null,
    band: null,
  };
}

/**
 * The attributes every figure-drawing primitive stamps on the element that
 * carries its figure: `data-figure` names it as a figure, `"static"` for a fact
 * the contract declares static and `"deterministic"` for one exact at any
 * instant, and `data-held` marks one that is not a reading of now. A render sweep reads the pair to find a held figure drawn as current.
 * No `data-figure` where there is no number to draw.
 */
export function figureAttributes(resolved: {
  readonly shown: unknown;
  readonly held: boolean;
  readonly mark?: ReckoningKind | null;
  readonly isStatic: boolean;
  readonly isDeterministic?: boolean;
}): {
  "data-figure": string | undefined;
  "data-held": "" | undefined;
  "data-reckoned": ReckoningKind | undefined;
} {
  return {
    "data-figure":
      resolved.shown == null
        ? undefined
        : resolved.isStatic
          ? "static"
          : resolved.isDeterministic
            ? "deterministic"
            : "",
    "data-held": resolved.held ? "" : undefined,
    "data-reckoned": resolved.held ? (resolved.mark ?? "held") : undefined,
  };
}

/**
 * The mark a derived figure takes, and its words: what a widget hands `<Unit marked>` for a number it computed from a reading's
 * payload (an apoapsis solved from an orbit) rather than read off a field.
 *
 * @category Unit
 */
export interface ReckoningMarking {
  kind: ReckoningKind;
  caption: string;
}

/**
 * How a figure derived from this reading should be marked, or null where the reading is a current observation of now.
 *
 * A current reading a model carried past the received edge marks `modelled`; a held one marks `held`, or `modelled` where a model
 * carries it. Use it for every displayed figure computed from a reading's payload, a plan's included.
 *
 * @category Unit
 */
export function derivedMarking(
  reading: Reading<unknown> | null | undefined,
  /** The figure is carried by a model that the reading itself does not name, such as a position the map models from the orbit. */
  carried = false,
): ReckoningMarking | null {
  if (reading == null) return null;
  if (reading.state === "observed") {
    return carried ||
      (reading.reckoning.status === "available" &&
        reading.reckoning.beyondReceived)
      ? { kind: "modelled", caption: MODELLED_TO_SCET }
      : null;
  }
  if (reading.state === "held") {
    const said = sayCurrency(heldWord(reading.grade), reading.asOfUt);
    return carried || reading.reckoning.status === "available"
      ? { kind: "modelled", caption: `${said}, modelled` }
      : { kind: "held", caption: said };
  }
  return null;
}
