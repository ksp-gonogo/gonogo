/**
 * The number to draw, and the statement the reading makes about it.
 *
 * Shared by every primitive that draws a figure, so a `Reading` cannot mean one
 * thing on a readout and another on the instrument beside it.
 */
import type { Reading, UncertaintyBand, Value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "./NullValue";
/*
 * The badge's own vocabulary, reused rather than mirrored: `StaleGrade` is a
 * subset of `StreamStatusValue`, so a stale reading's grade goes straight in
 * and a number cannot use a different word from the badge captioning its panel.
 */
import { formatStreamStatus } from "./StreamStatusBadge";
import { formatQuantity } from "./units";

/**
 * What a figure prop accepts: the quantity on its own, or the whole `Reading`
 * it arrived in.
 *
 * One type across every primitive that draws a figure, so a call site holding
 * a reading can fill a readout, a bar and an instrument with the same thing.
 *
 * A WIDENING rather than a replacement, and that is the whole shape of the
 * migration. The two are structurally distinguishable (`Reading` has a `state`,
 * a `Value` has a magnitude and a unit), so every call site written against the
 * narrow form keeps compiling and keeps rendering identically, and a call site
 * converts by handing over what it already holds instead of unwrapping it
 * first.
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
   * How far the reading's model would defend its answer, as it arrived. Left
   * unnarrowed: the unit an interval has to agree with is the SHOWN value's,
   * and the arms that carry no number have no unit to check it against.
   */
  band: UncertaintyBand | null;
}

/**
 * When the observation was made, on the game's own calendar, or null when the
 * reading carries no readable instant.
 *
 * Through `formatQuantity` rather than around it, so a held number and a
 * `<MissionDate>` beside it cannot print two spellings of one UT: the universal
 * time branch there delegates to `formatKspDate`, which reads whichever
 * calendar the running game reported. A malformed or non-finite `asOfUt` comes
 * back as `NULL_DISPLAY`, and answers null here instead: an "as of" followed by
 * the null token is worse than the grade on its own.
 */
function lastValidAt(asOfUt: Value<"ut"> | undefined): string | null {
  if (asOfUt === undefined) return null;
  const { value } = formatQuantity(asOfUt.magnitude, asOfUt.unit);
  return value === NULL_DISPLAY ? null : value;
}

/**
 * What the mark says in words: the grade, and how far back the number is from.
 *
 * Two levels: HOW stale a reading is is most of what staleness means, and a
 * glance at a wall of cells is not where it belongs: a date in every cell is
 * a date nobody reads. So the
 * dot answers the yes-or-no question at a glance, and this answers the
 * follow-up on demand, in the hover and in the accessibility tree.
 *
 * The grade word is `formatStreamStatus`'s and is never rephrased here.
 */
/**
 * The word for a held reading whose grade is not single.
 *
 * Deliberately outside `formatStreamStatus`'s vocabulary. `STALE`, `BLACKOUT`
 * and `RECORDED` name different KINDS of missed update and ask the operator
 * for different moves, so printing one of them for a reading that named none
 * asserts a reason nobody reported. This claims only what the state claims:
 * the number stands, and it is not a reading of now.
 */
const HELD_WITHOUT_GRADE = "HELD";

function sayCurrency(
  caption: string | null,
  asOfUt: Value<"ut"> | undefined,
): string | null {
  if (caption === null) return null;
  const at = lastValidAt(asOfUt);
  return at === null ? caption : `${caption}, as of ${at}`;
}

/**
 * Split what was handed in into the number and the statement about it.
 *
 * A bare `Value` (and `null`, and nothing at all) is current by construction:
 * it carries no currency, so there is nothing to say and nothing to draw, which
 * is what keeps the unconverted call sites byte-identical.
 *
 * `notCurrent` and `caption` are two fields rather than one nullable string on
 * purpose. `formatStreamStatus` answers `null` for `live` alone, which is not a
 * `StaleGrade` and so cannot arrive here, but deriving the MARK from the
 * caption would make an unmarked stale number the failure mode if that ever
 * stopped being true. The mark comes off the state, where it belongs.
 */
export function resolveCurrency<U extends string>(
  input: UnitValue<U> | null | undefined,
): Resolved<U> {
  /*
   * `in` throws on a primitive, and a bare number reaches this prop: several
   * callers hand over a raw magnitude rather than a `Value`, which the old
   * signature tolerated and which the widened one must keep tolerating. Guard
   * the discriminator on the type rather than trusting the declared union.
   */
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { shown: input, notCurrent: false, caption: null, band: null };
  }
  /*
   * Read once, ahead of the arms, because the two axes are orthogonal: a live
   * reading and a held one may each carry a model, so branching for the band
   * inside the states would be the same line written twice.
   */
  const band =
    input.reckoning.status === "available"
      ? (input.reckoning.band ?? null)
      : null;
  if (input.state === "observed") {
    return { shown: input.value, notCurrent: false, caption: null, band };
  }
  if (input.state === "stale") {
    /*
     * The mark follows the NUMBER and not the state. `Reading`'s value is
     * optional on every arm, so a held reading carrying none renders the null
     * token, and a staleness dot beside that would be a claim about nothing.
     *
     * Whatever IS marked gets words. `grade` is optional on the arm, and a
     * gradeless held reading is an ORDINARY shape rather than a corner case:
     * a derived reading is stale when ANY input is, and takes its grade from
     * whichever input speaks for the OLDEST instant, that input's absence of
     * one included. An observed input that is also the oldest therefore yields
     * stale, carrying a value, naming no grade. The result is itself an input
     * to the next combine, so the shape spreads rather than being diluted.
     *
     * Staying silent there draws a mark on a number and explains it nowhere,
     * which leaves the operator worse off than either word would.
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
      band,
    };
  }
  /*
   * pending, unowned and absent, which carry no number between them. `null`
   * rather than `undefined`, so the branch below still takes the value path
   * and renders the null token instead of falling through to the symbol form.
   * The band goes with them: an interval about a number nobody reported is an
   * interval about nothing.
   */
  return { shown: null, notCurrent: false, caption: null, band: null };
}
