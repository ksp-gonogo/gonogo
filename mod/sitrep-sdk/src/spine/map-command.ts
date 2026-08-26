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
 * or as a persistent axis, and whether it rides signal delay at all.
 */

/**
 * Command topics whose delay UX is a PERSISTENT stream indicator (fly-by-wire),
 * not a one-shot in-flight row. `vessel.control.setAxes` is the mod's
 * per-frame-re-applied override (pitch/yaw/roll/translation/trim); every Navball
 * axis/translation action routes to that one topic, so classifying it covers them all.
 */
const STREAM_COMMANDS: ReadonlySet<string> = new Set([
  "vessel.control.setAxes",
]);

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
 * persistent stream indicator (fly-by-wire). The unified `<CommandDelay>` reads this.
 */
export function commandShape(command: string): "discrete" | "stream" {
  return STREAM_COMMANDS.has(command) ? "stream" : "discrete";
}

/** Whether a command rides signal delay at all. Sim-meta controls (`time.*`) do not. */
export function commandDelayed(command: string): boolean {
  return !NEVER_DELAYED_COMMANDS.has(command);
}
