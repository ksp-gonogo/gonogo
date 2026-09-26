import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import { CommandOutcomeList } from "./CommandOutcomeList";
import {
  type CommandRefusalEntry,
  commandRefusalSentence,
} from "./commandRefusalSentence";
import type { RailTags } from "./railTags";

/**
 * One refused dispatch as the rail renders it: the refusal itself, plus the two
 * things only the registering handle knows, its stable id and the command's
 * rail axes.
 */
export interface RailRefusal extends CommandRefusalEntry {
  /**
   * The command's three axes. Only the MARK is read: a discrete command gets
   * the same terse glyph tile it carries in the in-flight queue, a continuous
   * one gets its text label, having no tile in that queue to match.
   */
  tags: RailTags;
}

export interface CommandRefusalListProps {
  refusals: readonly RailRefusal[];
  /** Clear one refusal. Omitted when no handle can dismiss, and the boxes then
   *  carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default). Off only where something
   * else already announces these outcomes, as the delay rail does.
   */
  live?: boolean;
  ariaLabel?: string;
}

/**
 * The refusals under the rail's two queues: what the game said no to, and why.
 *
 * The box chrome is `CommandOutcomeList`'s, shared with the losses beside them;
 * what belongs here is the composing, because a refusal quotes the game's
 * verdict and its numbers and no other outcome does.
 *
 * `role="status"` by default, which is `aria-live="polite"`: an entry arrives
 * on its own, a round trip after the press, when the operator may be looking
 * elsewhere. Never assertive, which is reserved for ABORT.
 *
 * An empty set draws nothing. A live list keeps its empty region mounted, so
 * the first entry to arrive is announced.
 */
export function CommandRefusalList({
  refusals,
  onDismiss,
  ariaLabel = "Refused commands",
  live = true,
}: Readonly<CommandRefusalListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      live={live}
      items={refusals.map((refusal) => {
        const subject = commandRefusalSubject(refusal);
        return {
          id: refusal.id,
          subject: subject || refusal.command || "",
          sentence: commandRefusalSentence(refusal),
          dismissLabel: `Dismiss ${subject || "refusal"}`,
          tags: refusal.tags,
        };
      })}
    />
  );
}
