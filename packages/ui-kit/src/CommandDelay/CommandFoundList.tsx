import {
  type CommandErrorCode,
  commandRefusalSubject,
  type LimitBreach,
} from "@ksp-gonogo/sitrep-sdk";
import { CommandOutcomeList } from "./CommandOutcomeList";
import { commandRefusalSentence } from "./commandRefusalSentence";
import type { RailTags } from "./railTags";

/**
 * One dispatch that was called lost and then answered after all, as much of it
 * as this text needs. Structurally the spine's `CommandFound`, so a hand-built
 * found can be rendered too. `outcome` is required: every sentence turns on it.
 */
export interface CommandFoundLike {
  /**
   * What the late reply turned out to say: the command executed, the game
   * refused it, or the machinery broke on the far side.
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

/** A found a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes. */
export interface CommandFoundEntry extends CommandFoundLike {
  id: string;
}

/** One found dispatch as the rail renders it, plus its command's rail axes. */
export interface RailFound extends CommandFoundEntry {
  tags: RailTags;
}

/**
 * What the operator is told about a command they were told was lost, which then
 * answered. Never "confirmed": the operator may already have re-sent it, and
 * "found" carries that reversal.
 *
 * - `ran`: it executed. If they re-sent it, it executed twice
 * - `refused`: it arrived and the game said no, in the refusal composer's words
 * - `errored`: it arrived and the machinery broke over there; a retry may work
 *
 * No imperative: the rail says what happened and lets the operator decide.
 */
export function commandFoundSentence(found: CommandFoundLike): string {
  const subject = commandRefusalSubject(found);
  const what = subject || found.command || "The command";
  // The reversal and the verdict, nothing else.
  const opening = (state: string) => `${what}: found ${state}.`;
  if (found.outcome === "refused") {
    // The refusal composer, not a second table of reasons.
    const clause =
      found.errorCode === undefined
        ? ""
        : `${stripSubject(
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
    return said ? `${opening("errored")} ${said}.` : opening("errored");
  }
  return `${opening("executed")}`;
}

/**
 * `Hire Valentina Kerman refused: the Astronaut Complex holds 16 of 16 active
 * crew.` -> `the Astronaut Complex holds 16 of 16 active crew.`, since the
 * found sentence already opens with the subject. Case is kept, so the game's
 * proper nouns survive.
 */
function stripSubject(sentence: string): string {
  const at = sentence.indexOf(": ");
  return at === -1 ? sentence : sentence.slice(at + 2);
}

export interface CommandFoundListProps {
  founds: readonly RailFound[];
  /** Clear one found. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default). Off only where something
   * else already announces these outcomes, as the delay rail does.
   */
  live?: boolean;
  ariaLabel?: string;
}

/**
 * The recovered dispatches under the rail's two queues. The same box as a
 * refusal and a loss, in a different tone: news about something that happened,
 * not a warning.
 *
 * `role="status"` (polite): a command turning up executed is a mission-state
 * change. An empty set draws nothing, but a live list keeps its empty region
 * mounted so the first entry is announced.
 */
export function CommandFoundList({
  founds,
  onDismiss,
  ariaLabel = "Lost commands that answered",
  live = true,
}: Readonly<CommandFoundListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      tone="notice"
      live={live}
      items={founds.map((found) => {
        const subject = commandRefusalSubject(found);
        return {
          id: found.id,
          subject: subject || found.command || "",
          sentence: commandFoundSentence(found),
          dismissLabel: `Dismiss ${subject || "found command"}`,
          tags: found.tags,
        };
      })}
    />
  );
}
