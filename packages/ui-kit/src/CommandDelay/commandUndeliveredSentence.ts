import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandLossEntry,
  CommandLossLike,
  RailLoss,
} from "./commandLossSentence";

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
