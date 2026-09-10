/**
 * How a command's delay UX behaves, keyed by the command's own topic.
 *
 * This file was the WRITE half of the vocabulary migration: a table from
 * widget-facing action keys (`f.ag1`, `t.timeWarp[4]`) onto the typed commands
 * the mod actually serves, plus the toggle-to-absolute bridges those keys needed
 * because a key cannot carry an argument. Every caller now names its command and
 * its arguments directly, so there is nothing left to translate.
 *
 * What remains is not translation. It is two facts about a command that no
 * caller should have to restate: whether its delay renders as one in-flight row
 * or as a persistent axis, and whether it rides signal delay at all. Neither is
 * a list written here any more; the first is read off the generated rail table
 * (see `../rail-tags`), and only the second is still a set of ids.
 */

import { railTagsForCommand } from "../rail-tags";

/**
 * Sim-meta command topics that never ride signal delay (instant, no delay UX):
 * time warp + pause are simulation controls, not commands that travel to a craft.
 */
const NEVER_DELAYED_COMMANDS: ReadonlySet<string> = new Set([
  "time.setWarpIndex",
  "time.setPaused",
]);

/**
 * How a command's delay UX renders: a discrete in-flight row (the default), or a
 * persistent stream indicator (fly-by-wire).
 *
 * The CONTINUITY axis in the rail's own words (see `../rail-tags`), which is
 * where the answer comes from: the command's owning assembly declares it on
 * `[SitrepCommand(..., Continuity = ...)]` and codegen carries it into the
 * generated rail table. This function used to consult a `Set` written in this
 * file holding exactly one id, which could name core's commands and
 * structurally could not name an Uplink's.
 *
 * Kept as its own spelling because the delay machinery still talks in
 * discrete/stream, and it is now a view of the tags rather than a second source
 * for them.
 */
export function commandShape(command: string): "discrete" | "stream" {
  return railTagsForCommand(command).continuity === "continuous"
    ? "stream"
    : "discrete";
}

/** Whether a command rides signal delay at all. Sim-meta controls (`time.*`) do not. */
export function commandDelayed(command: string): boolean {
  return !NEVER_DELAYED_COMMANDS.has(command);
}
