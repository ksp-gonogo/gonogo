// Runtime accessor for the contract's channel delay roles.
//
// A delay role is declared PER CHANNEL, in C# (`ChannelDeclaration.Delay` and
// `ChannelDeclaration.HeldAtHome`), and reaches the client two ways.
//
// The AUTHORITY is the running mod: `system.uplinks` carries a `delayRoles`
// block the engine builds from every channel it has registered, core and Uplink
// alike, so an Uplink built outside this repo is read in the right lane without
// anything here knowing its name. `readDeclaredDelayRoles` decodes that block and
// `TimelineStore` holds the newest one it was delivered.
//
// The FALLBACK is ./__generated__/delay-roles.ts, which `scripts/gen-delay-roles.mjs`
// scans out of the core declarations. It answers before the roster has arrived,
// against a mod that predates the block, and for replays recorded from one, and
// it is the typed union for core topics. It cannot see an Uplink channel, which
// is why it stops answering the moment the mod states its own roles.
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
 * A core topic the mod declares `DelayRole.TrueNow`.
 *
 * The set is deliberately small: uplink health, the body catalogue, the alarm
 * roster, the warp state and the comms geometry, none of which describe a craft
 * across the gap or a record held anywhere.
 */
export type TrueNowTopic = GeneratedTrueNowTopic;

/**
 * A core topic the mod declares held at the home command: the career ledger and
 * the space centre's records. Delayed, but to each vantage by its own delay to
 * home rather than by the active craft's light-time.
 */
export type HeldAtHomeTopic = GeneratedHeldAtHomeTopic;

/**
 * The roles a running mod stated for every channel it registered, as carried on
 * `system.uplinks.delayRoles`.
 *
 * Complete for that mod: a static topic in neither set is delayed, and so is a
 * dynamic topic under no prefix in `trueNowPrefixes`. No prefix list for held at
 * home, because a dynamic namespace cannot be held there.
 */
export interface DeclaredDelayRoles {
  readonly trueNow: ReadonlySet<string>;
  readonly heldAtHome: ReadonlySet<string>;
  readonly trueNowPrefixes: readonly string[];
}

const GENERATED_ROLES: DeclaredDelayRoles = {
  trueNow: new Set(GENERATED_TRUENOW_TOPICS),
  heldAtHome: new Set(GENERATED_HELD_AT_HOME_TOPICS),
  trueNowPrefixes: [],
};

function stringsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Decode the `delayRoles` block off a `system.uplinks` payload.
 *
 * `undefined` when the payload carries no block, which is a mod built before
 * contract 16.13 and not a mod declaring every channel delayed. A block missing
 * one of its lists is malformed rather than empty, and reads as absent for the
 * same reason: taking it at its word would move every core TrueNow channel into
 * the delayed lane on the strength of a field nobody sent.
 */
export function readDeclaredDelayRoles(
  rosterPayload: unknown,
): DeclaredDelayRoles | undefined {
  if (rosterPayload === null || typeof rosterPayload !== "object") {
    return undefined;
  }
  const block = (rosterPayload as { delayRoles?: unknown }).delayRoles;
  if (block === null || typeof block !== "object") return undefined;
  const raw = block as Record<string, unknown>;
  const trueNow = stringsOf(raw.trueNow);
  const heldAtHome = stringsOf(raw.heldAtHome);
  const trueNowPrefixes = stringsOf(raw.trueNowPrefixes);
  if (!trueNow || !heldAtHome || !trueNowPrefixes) return undefined;
  return {
    trueNow: new Set(trueNow),
    heldAtHome: new Set(heldAtHome),
    trueNowPrefixes,
  };
}

/** Whether the generated core table declares `topic` `DelayRole.TrueNow`. */
export function isTrueNowTopic(topic: string): topic is TrueNowTopic {
  return GENERATED_ROLES.trueNow.has(topic);
}

/** Whether the generated core table declares `topic` held at the home command. */
export function isHeldAtHomeTopic(topic: string): topic is HeldAtHomeTopic {
  return GENERATED_ROLES.heldAtHome.has(topic);
}

/**
 * Which lane `topic` is read in.
 *
 * Answers from `roles` when given, which is what the running mod stated and the
 * only answer that covers an Uplink channel. Without it, answers from the
 * generated core table, so a caller outside `TimelineStore` asking about an
 * Uplink topic gets `"delayed"` whatever the Uplink declared.
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
export function delayLaneOf(
  topic: string,
  roles: DeclaredDelayRoles = GENERATED_ROLES,
): DelayLane {
  if (roles.trueNow.has(topic) || roles.heldAtHome.has(topic)) {
    return "true-now";
  }
  return roles.trueNowPrefixes.some((prefix) => topic.startsWith(prefix))
    ? "true-now"
    : "delayed";
}
