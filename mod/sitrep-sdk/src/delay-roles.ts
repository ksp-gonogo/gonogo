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
  GENERATED_HELD_AT_HOME_TOPICS,
  GENERATED_TRUENOW_TOPICS,
  type GeneratedHeldAtHomeTopic,
  type GeneratedTrueNowTopic,
} from "./__generated__/delay-roles";

export type { GeneratedHeldAtHomeTopic, GeneratedTrueNowTopic };

/**
 * Which view time a read of a topic is entitled to.
 *
 * `"delayed"` is `now - light-time`, the default every channel takes unless it
 * declares otherwise. `"true-now"` subtracts nothing: it is the live estimate,
 * held to the newest sample actually delivered. That is the whole of a TrueNow
 * fact, and it is also the right read for a fact held at the home command, whose
 * light-time the mod has already spent before delivering it.
 */
export type DelayLane = "delayed" | "true-now";

/**
 * A topic the mod declares `DelayRole.TrueNow`.
 *
 * The set is deliberately small: uplink health, the body catalogue, the alarm
 * roster, the warp state and the comms geometry, none of which describe a craft
 * across the gap or a record held anywhere.
 */
export type TrueNowTopic = GeneratedTrueNowTopic;

/**
 * A topic the mod declares held at the home command: the career ledger and the
 * space centre's records. Delayed, but to each vantage by its own delay to home
 * rather than by the active craft's light-time.
 */
export type HeldAtHomeTopic = GeneratedHeldAtHomeTopic;

const TRUE_NOW: ReadonlySet<string> = new Set(GENERATED_TRUENOW_TOPICS);
const HELD_AT_HOME: ReadonlySet<string> = new Set(
  GENERATED_HELD_AT_HOME_TOPICS,
);

/** Whether the mod declares `topic` `DelayRole.TrueNow`. */
export function isTrueNowTopic(topic: string): topic is TrueNowTopic {
  return TRUE_NOW.has(topic);
}

/** Whether the mod declares `topic` held at the home command. */
export function isHeldAtHomeTopic(topic: string): topic is HeldAtHomeTopic {
  return HELD_AT_HOME.has(topic);
}

/**
 * Which lane `topic` is read in.
 *
 * A held-at-home topic takes the true-now lane. The delayed lane subtracts the
 * ACTIVE craft's light-time, which is not how far the reader is from the ledger:
 * a ground centre is no distance from it, and a crewed vessel is its own path
 * home, which the mod has already waited out before the frame arrived.
 *
 * Takes the WHOLE topic only. A field subtopic (`time.warp.warpRate`) is not a
 * declared channel and answers `"delayed"` here, so a caller that resolves
 * subtopics has to resolve first and ask second; `TimelineStore` does exactly
 * that, and asking the other way round would silently delay every field read of
 * a true-now channel while the whole-record read of the same channel was
 * current.
 */
export function delayLaneOf(topic: string): DelayLane {
  return TRUE_NOW.has(topic) || HELD_AT_HOME.has(topic)
    ? "true-now"
    : "delayed";
}
