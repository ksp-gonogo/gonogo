import {
  CommandErrorCode,
  commandRefusalSubject,
  describeErrorCode,
  type LimitBreach,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "../units";
import type { RailTags } from "./railTags";

/** One refused dispatch, as much of it as this text needs. Structurally the spine's `CommandRefusal`, so a hand-built refusal works too. */
export interface CommandRefusalLike {
  errorCode: CommandErrorCode;
  /** The refinement's id, when the refusal was more specific than its root `errorCode`. */
  reason?: string;
  /** The command id that was dispatched, e.g. `career.facility.upgrade`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
  /** The limit and the actual behind the reason, when the mod sent them. */
  breach?: LimitBreach;
  /**
   * The refusal in the GAME's own words, when the game had any to give: the arm
   * of `ClearToSaveStatus` it came back with, a strategy's own `CanBeActivated`
   * reason, a pre-flight test's warning title, a `[Description]`-tagged state
   * member's name. Preferred over every sentence written here: it stays right
   * when KSP changes and arrives localised.
   */
  detail?: string;
}

/**
 * A refusal a surface can render: the text's inputs plus the dispatch's own
 * `requestId`, which keys the box and is what `dismiss` takes. The spine's
 * `CommandRefusal` satisfies it structurally.
 */
export interface CommandRefusalEntry extends CommandRefusalLike {
  id: string;
}

/**
 * One refused dispatch as the rail renders it: the refusal itself, plus the two
 * things only the registering handle knows, its stable id and the command's
 * rail axes.
 */
export interface RailRefusal extends CommandRefusalEntry {
  /**
   * The command's three axes. Only the MARK is read: a discrete command gets
   * its in-flight glyph tile, a continuous one its text label.
   */
  tags: RailTags;
}

/** A number as it is written beside its unit (`253,000f`, `16`), through `units.ts` so funds read the same everywhere. */
function quantity(value: number, unit: string): string {
  return writeQuantity({ magnitude: value, unit });
}

/** The clause after the colon, or `null` when this arm needs numbers it did not get; never an invented "0 of 0". */
function comparison(
  errorCode: CommandErrorCode,
  breach: LimitBreach,
): string | null {
  const { limit, actual, unit } = breach;
  // `== null`: the wire writes an explicit JSON null for a breach with no numbers.
  if (limit == null || actual == null) return null;

  switch (errorCode) {
    case CommandErrorCode.LimitReached: {
      // Names the facility, since the operator's next move is at that building.
      const what = readableQuantity(breach.quantity);
      const counts = `${quantity(actual, unit)} of ${quantity(limit, unit)}`;
      return breach.facilityName
        ? `the ${breach.facilityName} holds ${counts} ${what}`
        : `it holds ${counts} ${what}`;
    }
    case CommandErrorCode.AlreadyAtMaximum:
      return `it is already at ${breach.quantity || "level"} ${quantity(actual, unit)} of ${quantity(limit, unit)}`;
    case CommandErrorCode.InsufficientFunds:
      // Actual is the price and Limit is the balance.
      return `it costs ${quantity(actual, unit)} and funds are ${quantity(limit, unit)}`;
    case CommandErrorCode.InsufficientScience:
      return `it costs ${quantity(actual, unit)} and science is ${quantity(limit, unit)}`;
    default:
      return null;
  }
}

/** `activeCrew` -> `active crew`: a camelCase id inside a sentence reads as a leaked variable. */
function readableQuantity(quantityId: string): string {
  return quantityId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** The sentence a code was declared with, or `null` when nothing this client knows declares it. */
function declaredSentence(id: string | undefined): string | null {
  return (id && describeErrorCode(id)?.sentence) || null;
}

/**
 * The game's own words as a mid-sentence clause: trimmed, trailing full stop
 * dropped. Case is never folded, which would damage KSP's proper nouns.
 */
function said(detail: string | undefined): string | null {
  const trimmed = detail?.trim().replace(/\.$/, "");
  return trimmed ? trimmed : null;
}

/**
 * What the operator reads when the game refuses a command:
 *
 *     Hire Valentina Kerman refused: the Astronaut Complex holds 16 of 16 active crew.
 *     Upgrade Launch Pad refused: it is already at tier 3 of 3.
 *     Upgrade Launch Pad refused: it costs 253,000f and funds are 189,412f.
 *
 * The command and args name the SUBJECT, the code picks the clause (the
 * refinement's own sentence ahead of its root's), and the `LimitBreach`
 * supplies the NUMBERS, written by `units.ts`.
 *
 * Names are user-supplied and unbounded, so whatever renders this must WRAP:
 * truncation eats the numbers off the end.
 */
export function commandRefusalSentence(refusal: CommandRefusalLike): string {
  return sentence(refusal, "refused");
}

/**
 * What the operator reads when the game will refuse a command that has not been
 * pressed yet:
 *
 *     Hire Valentina Kerman unavailable: the Astronaut Complex holds 16 of 16 active crew.
 *     Recover unavailable: the craft is throttled up.
 *
 * The same clause as {@link commandRefusalSentence}, so a control never says
 * one thing before the press and another after. "Unavailable" because nothing
 * has been asked yet: a gate is a condition that holds.
 */
export function commandGateSentence(gate: CommandRefusalLike): string {
  return sentence(gate, "unavailable");
}

function sentence(refusal: CommandRefusalLike, verb: string): string {
  const subject = commandRefusalSubject(refusal);
  const clause =
    (refusal.breach ? comparison(refusal.errorCode, refusal.breach) : null) ??
    // What the game itself said, ahead of anything declared.
    said(refusal.detail) ??
    declaredSentence(refusal.reason) ??
    declaredSentence(refusal.errorCode) ??
    // An id nothing declares is not prose, but it beats a bare "refused." with nothing after it.
    refusal.reason ??
    refusal.errorCode;
  return subject
    ? `${subject} ${verb}: ${clause}.`
    : `${verb.charAt(0).toUpperCase()}${verb.slice(1)}: ${clause}.`;
}
