import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./commandLossSentence";

/**
 * One dispatch that failed with an error rather than an answer. It has the same fields as {@link CommandLossLike}.
 *
 * @category CommandDelay
 */
export type CommandFailedLike = CommandLossLike;

/**
 * A failed dispatch a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes.
 *
 * @category CommandDelay
 */
export type CommandFailedEntry = CommandLossEntry;

/**
 * One failed dispatch as the rail renders it, plus its command's rail axes.
 *
 * @category CommandDelay
 */
export type RailFailed = RailLoss;

/**
 * What the operator is told about a command whose machinery broke: an error
 * came back in place of an answer, or the client went away while it waited.
 * Never "refused", which is the game's verdict, and never "never sent" or "may
 * have run", which each claim to know where the command got to. It does not
 * quote the error's own message.
 *
 * @category CommandDelay
 */
export function commandFailedSentence(failed: CommandFailedLike): string {
  const subject = commandRefusalSubject(failed);
  const what = subject || failed.command || "The command";
  return `${what}: failed, with no verdict from the game.`;
}
