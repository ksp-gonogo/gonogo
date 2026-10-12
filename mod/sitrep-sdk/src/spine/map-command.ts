/**
 * Whether a command rides signal delay at all, read off the mod's own
 * declaration rather than restated here.
 *
 * A hand-kept list of delayed commands would draw an undeclared command with
 * a countdown and an in-flight queue row that is a fiction about the
 * operator's own order, so the answer comes off `commandRail`, which is fed by
 * the generated map codegen builds from the same `[SitrepCommand(Delayed = ...)]`
 * the host dispatches by, and by whatever an Uplink registered from its own
 * generated map. One declaration, both halves reading it.
 */

import { commandRail } from "../commands";

/**
 * Whether a command is held back by the signal delay between the command centre
 * and the vessel. Useful for showing the operator whether a command takes
 * effect at once or after the delay. Used by `useCommand`.
 *
 * A command id that the generated maps do not carry counts as delayed, as the
 * host treats it, so a delayed command is never shown as instant.
 */
export function commandDelayed(command: string): boolean {
  return commandRail(command)?.delayed ?? true;
}
