// Runtime accessor for the contract's channel delay roles.
//
// A delay role is declared PER CHANNEL, in C# (`ChannelDeclaration.Delay`), and
// `scripts/gen-delay-roles.mjs` scans the declarations into
// ./__generated__/delay-roles.ts. This module is the hand-written accessor over
// that data, mirroring units.ts, control-channels.ts and reckonability.ts: the
// generated file stays free to change shape, and every consumer holds a named
// function instead of an import of the const.
//
// Two views, because two layers ask different questions, the same split
// reckonability.ts makes. The TYPE layer wants the topic union, so a caller can
// branch on a role at compile time rather than looking one up. The RUNTIME layer
// wants the predicate, because `TimelineStore` reads by a `string` topic that
// may be a field subtopic of a declared one, or a dynamic topic that has no
// declaration at all.
//
// ABSENT MEANS DELAYED, and that is a statement rather than an omission. The
// contract's own default is `DelayRole.Delayed`, and it is the safe direction:
// reading a ground-side fact late is merely late, where reading a craft's state
// early shows an operator the future.

import {
  GENERATED_TRUENOW_TOPICS,
  type GeneratedTrueNowTopic,
} from "./__generated__/delay-roles";

export type { GeneratedTrueNowTopic };

/**
 * Which view time a read of a topic is entitled to.
 *
 * `"delayed"` is `now - light-time`, the default every channel takes unless it
 * declares otherwise. `"true-now"` is the live estimate, for a ground-side fact
 * the command centre knows without waiting for a signal to cross the gap.
 */
export type DelayLane = "delayed" | "true-now";

/**
 * A topic the mod declares `DelayRole.TrueNow`.
 *
 * The set is deliberately small: it is the launch-site roster, the career
 * ledger, uplink health, the body catalogue, the alarm roster and the warp
 * state, none of which describe a craft across the gap.
 */
export type TrueNowTopic = GeneratedTrueNowTopic;

const TRUE_NOW: ReadonlySet<string> = new Set(GENERATED_TRUENOW_TOPICS);

/** Whether the mod declares `topic` `DelayRole.TrueNow`. */
export function isTrueNowTopic(topic: string): topic is TrueNowTopic {
  return TRUE_NOW.has(topic);
}

/**
 * Which lane `topic` is read in.
 *
 * Takes the WHOLE topic only. A field subtopic (`time.warp.warpRate`) is not a
 * declared channel and answers `"delayed"` here, so a caller that resolves
 * subtopics has to resolve first and ask second; `TimelineStore` does exactly
 * that, and asking the other way round would silently delay every field read of
 * a true-now channel while the whole-record read of the same channel was
 * current.
 */
export function delayLaneOf(topic: string): DelayLane {
  return TRUE_NOW.has(topic) ? "true-now" : "delayed";
}
