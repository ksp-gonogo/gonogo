import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import type { CommandLossLike } from "./commandLossSentence";
import type { RailTags } from "./railTags";

/**
 * One dispatch the mod accepted with a warning, still on its way: the fields of
 * {@link CommandLossLike}, plus what the mod said. Taken by
 * {@link commandWarningSentence}.
 * Useful for writing the sentence that tells the operator a command in flight
 * is likely to be lost.
 *
 * @category CommandDelay
 */
export interface CommandWarningLike extends CommandLossLike {
  /** What the mod said of the command, as a sentence. */
  warning: string;
}

/**
 * A warned dispatch a surface can render: the text's inputs plus the
 * dispatch's `requestId`, which keys the box. Used by the panel delay rail and
 * {@link CommandList}.
 *
 * @category CommandDelay
 */
export interface CommandWarningEntry extends CommandWarningLike {
  /** The dispatch's `requestId`, which keys the box. */
  id: string;
}

/**
 * One warned dispatch as the rail renders it, plus its command's rail axes.
 * Taken by {@link CommandList}.
 * Useful for telling the operator, on the panel's delay rail, which commands in
 * flight the mod warned about and what it said.
 *
 * @category CommandDelay
 */
export interface RailWarning extends CommandWarningEntry {
  /** The command's rail axes. */
  tags: RailTags;
}

/**
 * What the operator is told about a command the mod accepted with a warning:
 * the command, then the mod's own sentence. Useful for showing the operator
 * that a command still on its way, such as a throttle input, is likely to be
 * dropped. Used by {@link CommandList} and the panel delay rail.
 *
 * @category CommandDelay
 */
export function commandWarningSentence(warned: CommandWarningLike): string {
  const subject = commandRefusalSubject(warned);
  const what = subject || warned.command || "The command";
  return `${what}: ${warned.warning}`;
}
