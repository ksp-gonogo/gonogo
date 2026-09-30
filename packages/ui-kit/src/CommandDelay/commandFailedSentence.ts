import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./commandLossSentence";

/**
 * One dispatch whose machinery broke: it carries no verdict, so it takes the loss's shape.
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
 * have run", which each claim to know where the command got to. The error's own
 * message is not quoted: it is the machinery's prose, not the operator's.
 *
 * @category CommandDelay
 */
export function commandFailedSentence(failed: CommandFailedLike): string {
  const subject = commandRefusalSubject(failed);
  const what = subject || failed.command || "The command";
  return `${what}: failed, with no verdict from the game.`;
}
