import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import { CommandOutcomeList } from "./CommandOutcomeList";

/**
 * One dispatch nothing answered, as much of it as this text needs.
 *
 * Structurally the spine's `CommandLoss`, declared as a parameter shape rather
 * than imported wholesale for the same reason `CommandRefusalLike` is: ui-kit
 * stays the vanilla design system, and a hand-built loss (a test, a
 * peer-relayed one) can be rendered without pretending it came off a handle.
 */
export interface CommandLossLike {
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
}

/** A loss a surface can render: the text's inputs plus the dispatch's own
 *  `requestId`, which keys the box and is what `dismiss` takes. */
export interface CommandLossEntry extends CommandLossLike {
  id: string;
}

/** One lost dispatch as the rail renders it, plus whether its command is
 *  discrete or a stream (which only the registering handle knows). */
export interface RailLoss extends CommandLossEntry {
  shape: "discrete" | "stream";
}

/**
 * What the operator is told about a command that went quiet.
 *
 * Two words and a verdict the operator can act on. "May have run" is the whole
 * content of this state: the engine drops a command for an unreachable subject
 * without executing it, but a reply can also simply be lost on the way home, and
 * nothing on this side can tell those apart, so pressing again may do the thing
 * twice.
 *
 * What came out was everything the operator does not act on. "By the predicted
 * round trip" is the mechanism that decided the command was late, and "whether
 * it ran is unknown" is the definition of `lost` read back to someone already
 * looking at a box labelled lost.
 *
 * Deliberately never the word "refused": that is the game's verdict, and the
 * game never gave one here.
 */
export function commandLossSentence(loss: CommandLossLike): string {
  const subject = commandRefusalSubject(loss);
  const what = subject || loss.command || "The command";
  return `${what}: no reply. May have run.`;
}

export interface CommandLossListProps {
  losses: readonly RailLoss[];
  /** Clear one loss. Omitted when no handle can dismiss, and the boxes then
   *  carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  ariaLabel?: string;
}

/**
 * The unanswered dispatches under the rail's two queues, beside the refusals.
 *
 * It exists because these can have nothing in the in-flight queue to show. The
 * engine drops a command for an unreachable subject before it mints a pending
 * entry, so the whole delay UI, derived from that queue, drew nothing for the
 * command's entire life while the issuing control settled exactly as it does on
 * success.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandLossList({
  losses,
  onDismiss,
  ariaLabel = "Commands with no reply",
}: Readonly<CommandLossListProps>) {
  return (
    <CommandOutcomeList
      ariaLabel={ariaLabel}
      onDismiss={onDismiss}
      items={losses.map((loss) => {
        const subject = commandRefusalSubject(loss);
        return {
          id: loss.id,
          subject: subject || loss.command || "",
          sentence: commandLossSentence(loss),
          dismissLabel: `Dismiss ${subject || "loss"}`,
          shape: loss.shape,
        };
      })}
    />
  );
}
