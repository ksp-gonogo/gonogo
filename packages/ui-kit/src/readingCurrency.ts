/**
 * The number to draw, and the statement the reading makes about it.
 *
 * Shared by every primitive that draws a figure, so a `Reading` cannot mean one
 * thing on a readout and another on the instrument beside it.
 */
import type { Reading, UncertaintyBand, Value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "./NullValue";
// `StaleGrade` is a subset of `StreamStatusValue`, so a figure uses the same word as its panel's badge.
import { formatStreamStatus } from "./StreamStatusBadge";
import { formatQuantity } from "./units";

/**
 * What a figure prop accepts: the quantity on its own, or the whole `Reading`
 * it arrived in.
 *
 * One type across every primitive that draws a figure, so a call site holding
 * a reading can fill a readout, a bar and an instrument with the same thing.
 */
export type UnitValue<U extends string = string> = Value<U> | Reading<Value<U>>;

/** What {@link resolveCurrency} answers: the number to draw, and its currency. */
export interface Resolved<U extends string> {
  shown: Value<U> | null | undefined;
  /** Whether the number on screen is a reading of now. Drives the mark. */
  notCurrent: boolean;
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
 * The word for a held reading with no single grade. Outside
 * `formatStreamStatus`'s vocabulary, since each of its grades names a different
 * kind of missed update and nobody reported one.
 */
const HELD_WITHOUT_GRADE = "HELD";

/**
 * What the mark says in words: the grade, and how far back the number is from.
 * The dot answers at a glance; this answers the follow-up in the hover and the
 * accessibility tree.
 */

function sayCurrency(
  caption: string | null,
  asOfUt: Value<"ut"> | undefined,
): string | null {
  if (caption === null) return null;
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
const MODELLED_TO_SCET = "modelled to SCET";

/** The mark and its words for a held reading's observation. */
function heldCurrency<U extends string>(
  input: Reading<Value<U>>,
): Omit<Resolved<U>, "band"> {
  /*
   * The mark follows the number, not the state: a held reading with no value
   * gets no dot. Whatever is marked gets words, including the ordinary
   * gradeless held reading a derived value produces.
   */
  return {
    shown: input.value,
    notCurrent: input.value !== undefined,
    caption:
      input.value === undefined
        ? null
        : sayCurrency(
            input.grade === undefined
              ? HELD_WITHOUT_GRADE
              : formatStreamStatus(input.grade),
            input.asOfUt,
          ),
  };
}

/**
 * Split what was handed in into the number and the statement about it.
 *
 * A bare `Value` (and `null`, and nothing at all) is current by construction.
 * The mark comes off the state rather than the caption, so a stale number can
 * never go unmarked.
 */
export function resolveCurrency<U extends string>(
  input: UnitValue<U> | null | undefined,
  options: CurrencyOptions = {},
): Resolved<U> {
  // `in` throws on a primitive, and some callers hand over a raw magnitude.
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { shown: input, notCurrent: false, caption: null, band: null };
  }
  // The band is orthogonal to the state: a live reading and a held one may each carry a model.
  const band =
    input.reckoning.status === "available"
      ? (input.reckoning.band ?? null)
      : null;
  if (
    options.drawsReckoning &&
    input.reckoning.status === "available" &&
    (input.state === "observed" || input.state === "stale")
  ) {
    const shown = input.reckoning.modelled;
    if (input.state === "stale") {
      return { ...heldCurrency(input), shown, band };
    }
    const carried = input.reckoning.beyondReceived;
    return {
      shown,
      notCurrent: carried,
      caption: carried ? MODELLED_TO_SCET : null,
      band,
    };
  }
  if (input.state === "observed") {
    return { shown: input.value, notCurrent: false, caption: null, band };
  }
  if (input.state === "stale") return { ...heldCurrency(input), band };
  // `null` rather than `undefined`, so the caller renders the null token rather than the symbol form.
  return { shown: null, notCurrent: false, caption: null, band: null };
}
