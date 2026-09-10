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
  ariaLabel?: string;
}

/**
 * The refusals under the rail's two queues: what the game said no to, and why.
 *
 * The box chrome is `CommandOutcomeList`'s, shared with the losses beside them;
 * what belongs here is the composing, because a refusal quotes the game's
 * verdict and its numbers and no other outcome does.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandRefusalList({
  refusals,
  onDismiss,
  ariaLabel = "Refused commands",
}: Readonly<CommandRefusalListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
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
