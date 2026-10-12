/**
 * The vantage id `"meta"`, which stands for the program itself and not for any
 * command centre: a command sent from it reaches the vessel with no delay.
 * Useful for commands that have no physical origin, such as a tech unlock, a
 * strategy change or a contract accept, so they stay instant whichever command
 * centre the operator has selected. Used by the time warp control and the space
 * centre widgets.
 *
 * The same id comes back on `meta.vantage` for topics exempt from the delay: a
 * frame stamped with it says the topic is not delayed, and does not say where
 * the session is observing from. Matches the C# `MetaVantage` constant.
 */
export const META_VANTAGE = "meta";
