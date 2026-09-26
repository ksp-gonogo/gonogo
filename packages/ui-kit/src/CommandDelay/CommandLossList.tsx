import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import { CommandOutcomeList } from "./CommandOutcomeList";
import type { RailTags } from "./railTags";

/** One dispatch nothing answered, as much of it as this text needs. Structurally the spine's `CommandLoss`. */
export interface CommandLossLike {
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
}

/** A loss a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes. */
export interface CommandLossEntry extends CommandLossLike {
  id: string;
}

/** One lost dispatch as the rail renders it, plus its command's rail axes. */
export interface RailLoss extends CommandLossEntry {
  tags: RailTags;
}

/**
 * What the operator is told about a command that went quiet. "May have run":
 * a dropped command and a reply lost on the way home look the same from here,
 * so pressing again may do the thing twice. Never "refused", which is the
 * game's verdict.
 */
export function commandLossSentence(loss: CommandLossLike): string {
  const subject = commandRefusalSubject(loss);
  const what = subject || loss.command || "The command";
  return `${what}: no reply. May have run.`;
}

export interface CommandLossListProps {
  losses: readonly RailLoss[];
  /** Clear one loss. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default). Off only where something
   * else already announces these outcomes, as the delay rail does.
   */
  live?: boolean;
  ariaLabel?: string;
}

/**
 * The unanswered dispatches under the rail's two queues, beside the refusals.
 * A loss can have no in-flight entry at all, so only this shows it.
 *
 * `role="status"` (polite) by default: an entry arrives a round trip after the
 * press. An empty set draws nothing, but a live list keeps its empty region
 * mounted so the first entry is announced.
 */
export function CommandLossList({
  losses,
  onDismiss,
  ariaLabel = "Commands with no reply",
  live = true,
}: Readonly<CommandLossListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      live={live}
      items={losses.map((loss) => {
        const subject = commandRefusalSubject(loss);
        return {
          id: loss.id,
          subject: subject || loss.command || "",
          sentence: commandLossSentence(loss),
          dismissLabel: `Dismiss ${subject || "loss"}`,
          tags: loss.tags,
        };
      })}
    />
  );
}
