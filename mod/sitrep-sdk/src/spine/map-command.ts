/**
 * Whether a command rides signal delay at all, keyed by the command's own topic.
 *
 * This file was the WRITE half of the vocabulary migration: a table from
 * widget-facing action keys (`f.ag1`, `t.timeWarp[4]`) onto the typed commands
 * the mod actually serves, plus the toggle-to-absolute bridges those keys needed
 * because a key cannot carry an argument. Every caller now names its command and
 * its arguments directly, so there is nothing left to translate.
 *
 * What remains is one fact, and it is still a list of ids written here, which
 * is the thing to fix next. The mod already answers it per command, on
 * `CommandDeclaration.Delayed`, and nothing carries that answer to a client, so
 * this set is a client-side guess at it: it names two, and the mod marks
 * twenty-six. Until the declaration reaches the wire, a command the mod runs
 * instantly is still drawn here with a countdown.
 */

/**
 * Sim-meta command topics that never ride signal delay (instant, no delay UX):
 * time warp + pause are simulation controls, not commands that travel to a craft.
 */
const NEVER_DELAYED_COMMANDS: ReadonlySet<string> = new Set([
  "time.setWarpIndex",
  "time.setPaused",
]);

/** Whether a command rides signal delay at all. Sim-meta controls (`time.*`) do not. */
export function commandDelayed(command: string): boolean {
  return !NEVER_DELAYED_COMMANDS.has(command);
}
