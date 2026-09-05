import {
  type CommandErrorCode,
  commandRefusalSubject,
  type LimitBreach,
} from "@ksp-gonogo/sitrep-sdk";
import { CommandOutcomeList } from "./CommandOutcomeList";
import { commandRefusalSentence } from "./commandRefusalSentence";

/**
 * One dispatch that was called lost and then answered after all, as much of it
 * as this text needs.
 *
 * Structurally the spine's `CommandFound`, declared as a parameter shape rather
 * than imported wholesale for the same reason `CommandRefusalLike` and
 * `CommandLossLike` are: ui-kit stays the vanilla design system, and a
 * hand-built found (a test, a peer-relayed one) can be rendered without
 * pretending it came off a handle.
 *
 * `outcome` is the one field a loss did not have, and it is required, because
 * every sentence below turns on it. A found with no outcome is a found that
 * cannot say the only new thing it knows.
 */
export interface CommandFoundLike {
  /**
   * What the late reply turned out to say. Three outcomes because they send the
   * operator in three directions: the command executed, the game refused it, or
   * the machinery broke on the far side.
   */
  outcome: "ran" | "refused" | "errored";
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
  /** `outcome: "refused"` only: the game's typed reason. */
  errorCode?: CommandErrorCode;
  /** `outcome: "refused"` only: the limit and the actual behind the reason. */
  breach?: LimitBreach;
  /** `outcome: "refused"` only: the refusal in the game's own words. */
  detail?: string;
  /** `outcome: "errored"` only: what broke, in the machinery's own words. */
  error?: { code: string; message: string };
}

/** A found a surface can render: the text's inputs plus the dispatch's own
 *  `requestId`, which keys the box and is what `dismiss` takes. */
export interface CommandFoundEntry extends CommandFoundLike {
  id: string;
}

/** One found dispatch as the rail renders it, plus whether its command is
 *  discrete or a stream (which only the registering handle knows). */
export interface RailFound extends CommandFoundEntry {
  shape: "discrete" | "stream";
}

/**
 * What the operator is told about a command they were told was lost, which then
 * answered.
 *
 * Deliberately never the word "confirmed". Confirmed means it worked as
 * expected; this is the opposite of expected. The operator was given permission
 * to stop waiting, may well have re-sent the command on the strength of that,
 * and is now being told the first one arrived. So the sentence says the
 * reversal first ("found after being called lost") and the verdict second, and
 * the reversal is what makes it different from every other line the rail draws.
 *
 * The verdict clause differs by outcome because what the operator does next
 * does:
 *
 * - `ran`: it executed. If they re-sent it, it executed twice, and this is the
 *   only place that fact exists
 * - `refused`: it arrived and the game said no, in the same words a refusal
 *   would have used had it come back on time. A re-send is refused again until
 *   the world changes
 * - `errored`: it arrived and the machinery broke over there. It got through,
 *   which is the found part, and a retry may genuinely work
 *
 * No imperative anywhere in it. The rail is instrumentation: it says what
 * happened and lets the operator decide, the same way the loss sentence beside
 * it stops at "whether it ran is unknown".
 */
export function commandFoundSentence(found: CommandFoundLike): string {
  const subject = commandRefusalSubject(found);
  const what = subject || found.command || "The command";
  /*
   * The outcome sits INSIDE the opening rather than trailing it, so the word
   * that decides what the operator does next lands where the eye already is.
   * "being called" came out as redundant: lost is the state the rail showed,
   * not an accusation anyone made.
   */
  const opening = (state: string) =>
    `${what}: found ${state} after being lost.`;
  if (found.outcome === "refused") {
    /*
     * The refusal composer, not a second table of reasons. A late refusal is
     * the same verdict with the same numbers, and writing it out again here is
     * how the two would end up disagreeing about what LimitReached says.
     */
    const clause =
      found.errorCode === undefined
        ? ""
        : `The game gave its reason: ${stripSubject(
            commandRefusalSentence({
              errorCode: found.errorCode,
              command: found.command,
              args: found.args,
              label: found.label,
              breach: found.breach,
              detail: found.detail,
            }),
          )}`;
    return clause ? `${opening("refused")} ${clause}` : opening("refused");
  }
  if (found.outcome === "errored") {
    const said = found.error?.message?.trim().replace(/\.$/, "");
    return said
      ? `${opening("errored")} It reached the game: ${said}.`
      : `${opening("errored")} It reached the game.`;
  }
  return `${opening("executed")}`;
}

/**
 * `Hire Valentina Kerman refused: the Astronaut Complex holds 16 of 16 active
 * crew.` -> `the Astronaut Complex holds 16 of 16 active crew.`
 *
 * The subject is already the opening of the found sentence, so leaving it in
 * would name the command twice in one line. The clause comes out cased exactly
 * as the refusal composer wrote it, which is what keeps a proper noun the game
 * supplied (`Craft is over the mass limit`) from losing its capital.
 */
function stripSubject(sentence: string): string {
  const at = sentence.indexOf(": ");
  return at === -1 ? sentence : sentence.slice(at + 2);
}

export interface CommandFoundListProps {
  founds: readonly RailFound[];
  /** Clear one found. Omitted when no handle can dismiss, and the boxes then
   *  carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  ariaLabel?: string;
}

/**
 * The recovered dispatches under the rail's two queues, beside the losses they
 * used to be.
 *
 * It is the same box as a refusal and a loss, and deliberately a DIFFERENT
 * tone: those two are warnings about something that did not happen, and this is
 * news about something that did. Drawing it in the warning colour would put it
 * in the same bucket as the loss it replaced, which is the one reading it must
 * not have.
 *
 * `role="status"` on the list, which is `aria-live="polite"` by implication: a
 * command turning up executed is a mission-state change and it must reach an
 * operator who is looking somewhere else. Politely, never assertive: assertive
 * is reserved for ABORT, and this is news, not an interruption.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandFoundList({
  founds,
  onDismiss,
  ariaLabel = "Lost commands that answered",
}: Readonly<CommandFoundListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      tone="notice"
      live
      items={founds.map((found) => {
        const subject = commandRefusalSubject(found);
        return {
          id: found.id,
          subject: subject || found.command || "",
          sentence: commandFoundSentence(found),
          dismissLabel: `Dismiss ${subject || "found command"}`,
          shape: found.shape,
        };
      })}
    />
  );
}
