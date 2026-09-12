/**
 * Whether a command rides signal delay at all, read off the mod's own
 * declaration rather than restated here.
 *
 * This file was the WRITE half of the vocabulary migration: a table from
 * widget-facing action keys (`f.ag1`, `t.timeWarp[4]`) onto the typed commands
 * the mod actually serves, plus the toggle-to-absolute bridges those keys needed
 * because a key cannot carry an argument. Every caller now names its command and
 * its arguments directly, so there is nothing left to translate.
 *
 * What is left is one question, and it is no longer answered by a list written
 * here. It used to be: a hand-kept set naming two ids, against the fifty-four
 * the mod ran the instant they arrived, so fifty-two commands were drawn with a
 * countdown and an in-flight queue row that was a fiction about the operator's
 * own order. The answer now comes off `commandRail`, which is fed by
 * the generated map codegen builds from the SAME `[SitrepCommand(Delayed = ...)]`
 * the host dispatches by, and by whatever an Uplink registered from its own
 * generated map. One declaration, both halves reading it.
 */

import { commandRail } from "../commands";

/**
 * Whether a command rides signal delay at all.
 *
 * An id no generated map carries reads as delayed, matching what the host does
 * with one (`ChannelEngine.ResolveCommandDelay`) and erring in the safe
 * direction: a delayed command drawn instant has already crossed a gap the
 * operator was never shown.
 */
export function commandDelayed(command: string): boolean {
  return commandRail(command)?.delayed ?? true;
}
