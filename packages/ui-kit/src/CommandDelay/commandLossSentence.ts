import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type { RailTags } from "./railTags";

/**
 * One dispatch that got no reply, as much of it as the sentence needs. The
 * entries in `useCommand`'s `losses` satisfy it. Taken by
 * {@link commandLossSentence}.
 * Useful for writing the sentence that tells the operator a command got no
 * reply.
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
 * A loss a surface can render: the text's inputs plus the dispatch's
 * `requestId`, which keys the box and is what `dismiss` takes. Used by the panel
 * delay rail and {@link CommandList}.
 *
 * @category CommandDelay
 */
export interface CommandLossEntry extends CommandLossLike {
  /** The dispatch's `requestId`, which keys the box and is what `dismiss` takes. */
  id: string;
}

/**
 * One lost dispatch as the rail renders it, plus its command's rail axes. Taken
 * by {@link CommandList}.
 * Useful for telling the operator, on the panel's delay rail, which commands
 * got no reply.
 *
 * @category CommandDelay
 */
export interface RailLoss extends CommandLossEntry {
  /** The command's rail axes. */
  tags: RailTags;
}

/**
 * What the operator is told about a command that went quiet. "May have run":
 * a dropped command and a reply lost on the way back look the same to the
 * command centre, so pressing again may do the thing twice. Never "refused",
 * which is the game's verdict. Useful for telling the operator a command got no
 * reply and may still have run. Used by {@link CommandList}, the panel delay
 * rail and {@link CommandButton}.
 *
 * @category CommandDelay
 */
export function commandLossSentence(loss: CommandLossLike): string {
  const subject = commandRefusalSubject(loss);
  const what = subject || loss.command || "The command";
  return `${what}: no reply. May have run.`;
}
