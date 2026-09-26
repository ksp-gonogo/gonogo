import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./CommandLossList";
import { CommandOutcomeList } from "./CommandOutcomeList";

/** One dispatch that never left this machine: the same dispatch as a loss, at a later moment, so aliased onto the loss shape. */
export type CommandUndeliveredLike = CommandLossLike;

/** An undelivered dispatch a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes. */
export type CommandUndeliveredEntry = CommandLossEntry;

/** One undelivered dispatch as the rail renders it, plus its command's rail axes. */
export type RailUndelivered = RailLoss;

/**
 * What the operator is told about a command that never went out. It never left,
 * so pressing again repeats nothing: the inverse of the loss sentence, in a
 * different shape ("may have run" against "safe to re-send") so polarity is not
 * the only difference. "Safe to re-send" is a fact, not advice.
 *
 * The transport's `reason` is not quoted: the phase has one cause, and which
 * connection gave up changes nothing the operator does. Never "lost", which
 * carries the opposite advice.
 */
export function commandUndeliveredSentence(
  undelivered: CommandUndeliveredLike,
): string {
  const subject = commandRefusalSubject(undelivered);
  const what = subject || undelivered.command || "The command";
  return `${what}: never sent. Safe to re-send.`;
}

export interface CommandUndeliveredListProps {
  undelivered: readonly RailUndelivered[];
  /** Clear one undelivered dispatch. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default). Off only where something
   * else already announces these outcomes, as the delay rail does.
   */
  live?: boolean;
  ariaLabel?: string;
}

/**
 * The commands that never went out, under the rail's two queues. Warning-toned,
 * unlike the found list: the command did not happen.
 *
 * `role="status"` (polite): an entry appears minutes after the press, when a
 * transport gives up on a link. An empty set draws nothing, but a live list
 * keeps its empty region mounted so the first entry is announced.
 */
export function CommandUndeliveredList({
  undelivered,
  onDismiss,
  ariaLabel = "Commands that were never sent",
  live = true,
}: Readonly<CommandUndeliveredListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      live={live}
      items={undelivered.map((entry) => {
        const subject = commandRefusalSubject(entry);
        return {
          id: entry.id,
          subject: subject || entry.command || "",
          sentence: commandUndeliveredSentence(entry),
          dismissLabel: `Dismiss ${subject || "unsent command"}`,
          tags: entry.tags,
        };
      })}
    />
  );
}
