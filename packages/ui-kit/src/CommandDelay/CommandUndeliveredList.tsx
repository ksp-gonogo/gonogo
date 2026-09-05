import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./CommandLossList";
import { CommandOutcomeList } from "./CommandOutcomeList";

/**
 * One dispatch that never left this machine, as much of it as this text needs.
 *
 * Structurally the spine's `CommandUndelivered`, which is a `CommandLoss` plus
 * the transport's own `reason`. Aliased onto the loss shapes rather than
 * re-declared, because the two ARE the same dispatch at two moments and a
 * second copy of the fields is the shape that drifts.
 *
 * The `reason` is deliberately not among them: see `commandUndeliveredSentence`
 * for why this box composes its own words instead of quoting the transport's.
 */
export type CommandUndeliveredLike = CommandLossLike;

/** An undelivered dispatch a surface can render: the text's inputs plus the
 *  dispatch's own `requestId`, which keys the box and is what `dismiss` takes. */
export type CommandUndeliveredEntry = CommandLossEntry;

/** One undelivered dispatch as the rail renders it, plus whether its command is
 *  discrete or a stream (which only the registering handle knows). */
export type RailUndelivered = RailLoss;

/**
 * What the operator is told about a command that never went out.
 *
 * Two facts, and the second one is the whole reason this phase exists. It never
 * left, so nothing over there ran it, so sending it again repeats nothing. That
 * is the INVERSE of the loss sentence sitting above it in the rail: "whether it
 * ran is unknown" earns its caution from a command that may be waiting on the
 * far side, and this one is waiting on THIS side, where we can see it.
 *
 * Written as a fact and not as advice. The rail is instrumentation: it says a
 * re-send cannot double the command and lets the operator decide whether to
 * make one, the same way the loss beside it stops at what is known.
 *
 * It does not quote the transport's `reason`, though the entry carries one, and
 * the loss sentence beside it takes the same line. The phase has exactly one
 * cause (a link that did not come back), so the words that matter are the same
 * every time and belong here where they can be written once; the reason's own
 * unique half is which connection gave up, which changes nothing the operator
 * does next.
 *
 * Deliberately never the word "lost": that is the state this replaces, and the
 * two carry opposite advice.
 */
export function commandUndeliveredSentence(
  undelivered: CommandUndeliveredLike,
): string {
  const subject = commandRefusalSubject(undelivered);
  const what = subject || undelivered.command || "The command";
  return `${what}: never left this machine. Nothing ran it, so a re-send cannot double it.`;
}

export interface CommandUndeliveredListProps {
  undelivered: readonly RailUndelivered[];
  /** Clear one undelivered dispatch. Omitted when no handle can dismiss, and the
   *  boxes then carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  ariaLabel?: string;
}

/**
 * The commands that never went out, under the rail's two queues and beside the
 * losses they were promoted from.
 *
 * Warning-toned, unlike the found list next to it: a found reverses a failure
 * and this one confirms one. The command did not run, and the news is that we
 * now know it did not, which still belongs in the colour an operator reads as
 * "this did not happen".
 *
 * `role="status"`, which is `aria-live="polite"` by implication: an entry
 * appears here on its own, minutes after the press, when a transport gives up
 * on a link. Politely, never assertive: assertive is reserved for ABORT.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandUndeliveredList({
  undelivered,
  onDismiss,
  ariaLabel = "Commands that were never sent",
}: Readonly<CommandUndeliveredListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      live
      items={undelivered.map((entry) => {
        const subject = commandRefusalSubject(entry);
        return {
          id: entry.id,
          subject: subject || entry.command || "",
          sentence: commandUndeliveredSentence(entry),
          dismissLabel: `Dismiss ${subject || "unsent command"}`,
          shape: entry.shape,
        };
      })}
    />
  );
}
