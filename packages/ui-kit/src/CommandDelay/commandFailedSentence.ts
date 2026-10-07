import {
  commandRefusalSubject,
  describeErrorCode,
} from "@ksp-gonogo/sitrep-sdk";
import type { CommandLossLike } from "./commandLossSentence";
import type { RailTags } from "./railTags";

/**
 * One dispatch that failed with an error rather than an answer: the fields of
 * {@link CommandLossLike}, plus the fault it was answered with.
 *
 * @category CommandDelay
 */
export interface CommandFailedLike extends CommandLossLike {
  /** The fault the dispatch was answered with, a `FaultCode` id, when one came back. */
  code?: string;
}

/**
 * A failed dispatch a surface can render: the text's inputs plus the dispatch's `requestId`, which keys the box and is what `dismiss` takes.
 *
 * @category CommandDelay
 */
export interface CommandFailedEntry extends CommandFailedLike {
  id: string;
}

/**
 * One failed dispatch as the rail renders it, plus its command's rail axes.
 *
 * @category CommandDelay
 */
export interface RailFailed extends CommandFailedEntry {
  tags: RailTags;
}

/**
 * What the operator is told about a command that came back with a fault in
 * place of an answer. A fault the code table declares is said in its own
 * sentence, since the mod has said what became of the command: it expired, was
 * cancelled, or a game load undid it. Anything else, the machinery breaking
 * or the client going away while it waited, gets no verdict. Never "refused",
 * which is the game's verdict, and it does not quote the error's own message.
 *
 * @category CommandDelay
 */
export function commandFailedSentence(failed: CommandFailedLike): string {
  const subject = commandRefusalSubject(failed);
  const what = subject || failed.command || "The command";
  const said =
    failed.code === undefined ? undefined : describeErrorCode(failed.code);
  return said?.kind === "fault"
    ? `${what}: failed, ${said.sentence}.`
    : `${what}: failed, with no verdict from the game.`;
}
