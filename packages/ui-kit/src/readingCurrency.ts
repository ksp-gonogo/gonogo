/**
 * The number to draw, and the statement the reading makes about it.
 *
 * Shared by every primitive that draws a figure, so a `Reading` cannot mean one
 * thing on a readout and another on the instrument beside it.
 */
import {
  isStaticValue,
  type Reading,
  type UncertaintyBand,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "./NullValue";
import { heldWord } from "./status/streamStatusWord";
import { formatQuantity } from "./units";

/**
 * What a figure prop accepts: the quantity on its own, or the whole `Reading`
 * it arrived in.
 *
 * One type across every primitive that draws a figure, so a call site holding
 * a reading can fill a readout, a bar and an instrument with the same thing.
 */
export type UnitValue<Unit extends string = string> =
  | Value<Unit>
  | Reading<Value<Unit>>;

/** What {@link resolveCurrency} answers: the number to draw, and its currency. */
export interface Resolved<Unit extends string> {
  shown: Value<Unit> | null | undefined;
  /** Whether the number on screen is a reading of now. Drives the mark. */
  held: boolean;
  /**
   * Whether the number is a fact the contract declares static, which is never
   * old and so is never marked held, whatever the reading's state.
   */
  isStatic: boolean;
  /**
   * What the mark means in words: the grade where the reading names one, a
   * grade-neutral word where it does not, and the instant the number was last
   * a reading of now where that is readable. Said rather than shown, and null
   * only where nothing was marked.
   */
  caption: string | null;
  /**
   * How far the reading's model would defend its answer, as it arrived, left
   * unnarrowed: the unit it must agree with is the shown value's.
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

/** How a primitive reads a {@link Reading}. */
export interface CurrencyOptions {
  /**
   * The consumer draws the reading's reckoning, where one is on offer, rather
   * than its observation: a countdown, or a figure a widget solves forward.
   * The modelled figure is then marked wherever it is not a reading of now,
   * which under signal delay includes a current reading carried to SCET.
   */
  readonly drawsReckoning?: boolean;
}

/** The mark's words for a current reading whose figure the model carried across the light-time. */
export const MODELLED_TO_SCET = "modelled to SCET";

/**
 * What the model says a current reading's figure is at the instant it reckoned
 * to, where that is past the received edge: the figure a widget draws beside
 * the observation with `ModelledAlongside`. `undefined` everywhere else.
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
  if (isStaticValue(input.value)) {
    return { shown: input.value, held: false, isStatic: true, caption: null };
  }
  return {
    shown: input.value,
    held: input.value !== undefined,
    isStatic: false,
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
 * The mark comes off the state rather than the caption, so a held number can
 * never go unmarked.
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
      isStatic: isStaticValue(input),
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
    (input.state === "observed" || input.state === "held")
  ) {
    const shown = input.reckoning.modelled;
    if (input.state === "held") {
      return { ...heldCurrency(input), shown, band };
    }
    const carried = input.reckoning.beyondReceived;
    return {
      shown,
      held: carried,
      isStatic: false,
      caption: carried ? MODELLED_TO_SCET : null,
      band,
    };
  }
  if (input.state === "observed") {
    return {
      shown: input.value,
      held: false,
      isStatic: isStaticValue(input.value),
      caption: null,
      band,
    };
  }
  if (input.state === "held") return { ...heldCurrency(input), band };
  // `null` rather than `undefined`, so the caller renders the null token rather than the symbol form.
  return {
    shown: null,
    held: false,
    isStatic: false,
    caption: null,
    band: null,
  };
}

/**
 * The attributes every figure-drawing primitive stamps on the element that
 * carries its figure: `data-figure` names it as a figure, `"static"` for a fact
 * the contract declares static, and `data-held` marks one that is not a reading
 * of now. A render sweep reads the pair to find a held figure drawn as current.
 * No `data-figure` where there is no number to draw.
 */
export function figureAttributes(resolved: {
  readonly shown: unknown;
  readonly held: boolean;
  readonly isStatic: boolean;
}): { "data-figure": string | undefined; "data-held": "" | undefined } {
  return {
    "data-figure":
      resolved.shown == null ? undefined : resolved.isStatic ? "static" : "",
    "data-held": resolved.held ? "" : undefined,
  };
}
