import {
  CommandErrorCode,
  commandRefusalSubject,
  type LimitBreach,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "../units";

/**
 * One refused dispatch, as much of it as this text needs.
 *
 * Structurally the spine's `CommandRefusal`, declared as a parameter shape
 * rather than imported wholesale so the composer can be called with a
 * hand-built refusal (a test, a peer-relayed one missing half its fields)
 * without pretending those are the same thing.
 */
export interface CommandRefusalLike {
  errorCode: CommandErrorCode;
  /** The command id that was dispatched, e.g. `career.facility.upgrade`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
  /** The limit and the actual behind the reason, when the mod sent them. */
  breach?: LimitBreach;
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
 * A number as it is written beside its unit: `253,000f`, `16`.
 *
 * Goes through `units.ts` rather than `toLocaleString` because that module is
 * the one place that knows currency is grouped and written tight while an SI
 * quantity is not, and knows a bare count has no symbol at all. Getting that
 * from a second place here is how `42,500f` and `42500 funds` end up on the
 * same dashboard.
 */
function quantity(value: number, unit: string): string {
  return writeQuantity({ magnitude: value, unit });
}

/**
 * The clause after the colon, or `null` when this arm needs numbers it did not
 * get. The general fallbacks are the caller's job (below), because "a limit has
 * been reached" is still worth saying and an invented "0 of 0" is not.
 */
function comparison(
  errorCode: CommandErrorCode,
  breach: LimitBreach,
): string | null {
  const { limit, actual, unit } = breach;
  if (limit === undefined || actual === undefined) return null;

  switch (errorCode) {
    case CommandErrorCode.LimitReached: {
      // The facility is the subject of this clause: the operator's next move is
      // at that building, and naming it is what turns "full" into somewhere to
      // go. Falls back to the impersonal form when the mod sent no display name.
      const what = readableQuantity(breach.quantity);
      const counts = `${quantity(actual, unit)} of ${quantity(limit, unit)}`;
      return breach.facilityName
        ? `the ${breach.facilityName} holds ${counts} ${what}`
        : `it holds ${counts} ${what}`;
    }
    case CommandErrorCode.AlreadyAtMaximum:
      return `it is already at ${breach.quantity || "level"} ${quantity(actual, unit)} of ${quantity(limit, unit)}`;
    case CommandErrorCode.InsufficientFunds:
      // Actual is the price and Limit is the balance: what was asked for
      // against what was allowed, the same way round as every other breach.
      return `it costs ${quantity(actual, unit)} and funds are ${quantity(limit, unit)}`;
    default:
      return null;
  }
}

/**
 * The general sentence for an arm whose numbers are missing or that has no
 * numbers to give. Says what happened and stops, rather than reaching for the
 * enum member name, which is a C# identifier and reads like one.
 */
const GENERAL_REASON: Partial<Record<CommandErrorCode, string>> = {
  [CommandErrorCode.LimitReached]: "a limit has been reached",
  [CommandErrorCode.AlreadyAtMaximum]: "it is already at its maximum",
  [CommandErrorCode.InsufficientFunds]: "there are not enough funds",
};

/**
 * `activeCrew` -> `active crew`. The contract's quantity names are ids, written
 * in the camelCase every id in it uses, and an id printed inside a sentence
 * reads as a leaked variable.
 */
function readableQuantity(quantityId: string): string {
  return quantityId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * What the operator reads when the game refuses a command:
 *
 *     Hire Valentina Kerman refused: the Astronaut Complex holds 16 of 16 active crew.
 *     Upgrade Launch Pad refused: it is already at tier 3 of 3.
 *     Upgrade Launch Pad refused: it costs 253,000f and funds are 189,412f.
 *
 * Three sources meet here and none of them could produce this alone. The
 * command and its args name the SUBJECT (`commandRefusalSubject`, in the sdk
 * because an Uplink needs the same rule). The typed `errorCode` picks WHICH
 * clause, because it is the only thing that knows a full complex from a maxed
 * building from an unaffordable one, and it used to know none of those (all
 * three arrived as `ModeUnavailable` or `Range`). The `LimitBreach` supplies the
 * NUMBERS, which is the part an operator called actionable, and `units.ts`
 * writes them so a fund reads the way funds read everywhere else on the board.
 *
 * Composed here rather than in the mod deliberately: the mod would have to bake
 * an English sentence in one unit system, and this layer already renders the
 * operator's own.
 *
 * Sentences measure 47 to about 100 characters. Craft and facility names are
 * user-supplied and unbounded, so whatever renders this must WRAP: truncation
 * eats the numbers off the end, which are the only actionable part.
 */
export function commandRefusalSentence(refusal: CommandRefusalLike): string {
  const subject = commandRefusalSubject(refusal);
  const clause =
    (refusal.breach ? comparison(refusal.errorCode, refusal.breach) : null) ??
    GENERAL_REASON[refusal.errorCode] ??
    // An arm with no sentence of its own still has to say something true. The
    // enum member is not prose, but it is the mod's own word for what happened
    // and it beats "refused." with nothing after it.
    CommandErrorCode[refusal.errorCode] ??
    String(refusal.errorCode);
  return subject ? `${subject} refused: ${clause}.` : `Refused: ${clause}.`;
}
