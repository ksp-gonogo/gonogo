import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./commandLossSentence";

/**
 * One dispatch that never left this machine. It has the same fields as {@link CommandLossLike}.
 *
 * @category CommandDelay
 */
export type CommandUndeliveredLike = CommandLossLike;

/**
 * An undelivered dispatch a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes.
 *
 * @category CommandDelay
 */
export type CommandUndeliveredEntry = CommandLossEntry;

/**
 * One undelivered dispatch as the rail renders it, plus its command's rail axes.
 *
 * @category CommandDelay
 */
export type RailUndelivered = RailLoss;

/**
 * What the operator is told about a command that never went out: it did not
 * run, so it is safe to re-send. It never says "lost", which means the
 * opposite ("may have run"), and does not quote the connection's own error.
 *
 * @category CommandDelay
 */
export function commandUndeliveredSentence(
  undelivered: CommandUndeliveredLike,
): string {
  const subject = commandRefusalSubject(undelivered);
  const what = subject || undelivered.command || "The command";
  return `${what}: never sent. Safe to re-send.`;
}
