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
   * its in-flight glyph tile, a continuous one its text label.
   */
  tags: RailTags;
}

export interface CommandRefusalListProps {
  refusals: readonly RailRefusal[];
  /** Clear one refusal. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default). Off only where something
   * else already announces these outcomes, as the delay rail does.
   */
  live?: boolean;
  ariaLabel?: string;
}

/**
 * The refusals under the rail's two queues: what the game said no to, and why,
 * in `CommandOutcomeList`'s box chrome.
 *
 * `role="status"` (polite) by default: an entry arrives a round trip after the
 * press. An empty set draws nothing, but a live list keeps its empty region
 * mounted so the first entry is announced.
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
