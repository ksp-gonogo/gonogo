import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type { RailTags } from "./railTags";

/**
 * One dispatch that got no reply, as much of it as this text needs. Structurally the spine's `CommandLoss`.
 *
 * @category CommandDelay
 */
export interface CommandLossLike {
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command?: string;
  /** The args it was dispatched with. */
  args?: unknown;
  /** The dispatch's own operator-facing description, when it carried one. */
  label?: string;
}

/**
 * A loss a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes.
 *
 * @category CommandDelay
 */
export interface CommandLossEntry extends CommandLossLike {
  id: string;
}

/**
 * One lost dispatch as the rail renders it, plus its command's rail axes.
 *
 * @category CommandDelay
 */
export interface RailLoss extends CommandLossEntry {
  tags: RailTags;
}

/**
 * What the operator is told about a command that went quiet. "May have run":
 * a dropped command and a reply lost on the way home look the same from here,
 * so pressing again may do the thing twice. Never "refused", which is the
 * game's verdict.
 *
 * @category CommandDelay
 */
export function commandLossSentence(loss: CommandLossLike): string {
  const subject = commandRefusalSubject(loss);
  const what = subject || loss.command || "The command";
  return `${what}: no reply. May have run.`;
}
