/**
 * Whether a command rides signal delay at all, read off the mod's own
 * declaration rather than restated here.
 *
 * A hand-kept list of delayed commands would draw an undeclared command with
 * a countdown and an in-flight queue row that is a fiction about the
 * operator's own order, so the answer comes off `commandRail`, which is fed by
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
