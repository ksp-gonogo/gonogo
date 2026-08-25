/**
 * The program-meta vantage: a command sent from `"meta"` is instant
 * (`DelayTo("meta", *) = 0` server-side, `ChannelEngine.MetaVantage`). Program
 * acts with no physical vantage (tech unlock, strategy, contract accept) pass
 * this so they stay instant regardless of the operator's selected command
 * centre. Kept in sync with the C# `MetaVantage` constant.
 *
 * The same id comes back DOWN the wire on `meta.vantage`: instant-class topics
 * are routed onto it at subscribe time, so a frame stamped with it is telling
 * you the topic is exempt from the delay, not where the session is observing
 * from. `TelemetryClient.observedVantage` reads it for exactly that reason,
 * which is why this lives in its own module: `client.ts` sits below
 * `use-command.ts` in the import graph and cannot reach up to it.
 */
export const META_VANTAGE = "meta";
