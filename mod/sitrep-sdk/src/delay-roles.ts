// Runtime accessor for the contract's channel delay roles.
//
// A delay role is declared PER CHANNEL, in C# (`ChannelDeclaration.Delay` and `ChannelDeclaration.HeldAtHome`), and reaches the client two ways.
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
  GENERATED_ADDRESSED_TOPICS,
  GENERATED_HELD_AT_HOME_TOPICS,
  GENERATED_TRUENOW_TOPICS,
  type GeneratedHeldAtHomeTopic,
  type GeneratedTrueNowTopic,
} from "./__generated__/delay-roles";

/**
 * Which instant a Topic is read at:
 *
 * - `"delayed"`: the view time minus the signal delay to the active craft. The
 *   default for every Topic that declares nothing else
 * - `"true-now"`: the newest value received, with no delay subtracted. For a
 *   Topic that is true at the command centre rather than out at a craft, such
 *   as the warp state, and for one whose delay the mod has already applied
 *   before sending it
 *
 * @category Delay and vantage
 */
export type DelayLane = "delayed" | "true-now";

/**
 * A Gonogo Topic that is read with no signal delay, because it does not
 * describe a craft across the gap: uplink health, the celestial bodies, the
 * alarms, the warp state and the comms network's layout.
 *
 * @category Delay and vantage
 */
export type TrueNowTopic = GeneratedTrueNowTopic;

/**
 * A Gonogo Topic held at the home command centre, such as the career's
 * finances and the space centre's records. Each command centre reads it at its
 * own delay from home rather than at the active craft's delay. The mod applies
 * that delay before it sends the Topic, so the client reads it in the
 * `"true-now"` {@link DelayLane} and subtracts nothing more.
 *
 * @category Delay and vantage
 */
export type HeldAtHomeTopic = GeneratedHeldAtHomeTopic;

/**
 * How the running mod says each Topic is delayed, as carried on the
 * `delayRoles` field of `system.uplinks`. It covers Uplink Topics as well as
 * Gonogo's own. A Topic in none of the sets, and not under a prefix in
 * `trueNowPrefixes`, is delayed.
 *
 * @category Delay and vantage
 */
export interface DeclaredDelayRoles {
  /** Topics read with no signal delay. See {@link TrueNowTopic}. */
  readonly trueNow: ReadonlySet<string>;
  /** Topics held at the home command centre. See {@link HeldAtHomeTopic}. */
  readonly heldAtHome: ReadonlySet<string>;
  /** Prefixes under which every Topic is read with no signal delay. */
  readonly trueNowPrefixes: readonly string[];
  /**
   * Topics whose values are each sent to a particular command centre, such as
   * that centre's own contact plan. The mod delivers each value after its own
   * delay, so it is read as received.
   */
  readonly addressed: ReadonlySet<string>;
}

const GENERATED_ROLES: DeclaredDelayRoles = {
  trueNow: new Set(GENERATED_TRUENOW_TOPICS),
  heldAtHome: new Set(GENERATED_HELD_AT_HOME_TOPICS),
  trueNowPrefixes: [],
  addressed: new Set(GENERATED_ADDRESSED_TOPICS),
};

function stringsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Returns the {@link DeclaredDelayRoles} carried on a `system.uplinks`
 * payload, or `undefined` when it carries none or is missing one of the
 * `trueNow`, `heldAtHome` and `trueNowPrefixes` lists. A missing `addressed`
 * list reads as empty.
 *
 * @category Delay and vantage
 */
// A partial block reads as absent: trusting it would move every core true-now channel to the delayed lane.
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
    addressed: new Set(stringsOf(raw.addressed) ?? []),
  };
}

/**
 * Returns whether `topic` is a {@link TrueNowTopic}. Uplink Topics are not
 * covered; use {@link delayLaneOf} with the mod's {@link DeclaredDelayRoles}
 * for those.
 *
 * @category Delay and vantage
 */
export function isTrueNowTopic(topic: string): topic is TrueNowTopic {
  return GENERATED_ROLES.trueNow.has(topic);
}

/**
 * Returns whether `topic` is a {@link HeldAtHomeTopic}. Uplink Topics are not
 * covered.
 *
 * @category Delay and vantage
 */
export function isHeldAtHomeTopic(topic: string): topic is HeldAtHomeTopic {
  return GENERATED_ROLES.heldAtHome.has(topic);
}

/**
 * Returns the {@link DelayLane} `topic` is read in.
 *
 * Pass the mod's `roles`, from {@link readDeclaredDelayRoles}, to cover Uplink
 * Topics. Without them only Gonogo's own Topics are known, and every Uplink
 * Topic reads `"delayed"`.
 *
 * A Topic held at the home command centre, and an addressed Topic, are read
 * `"true-now"`: the mod has already applied their delay before sending them.
 *
 * Pass a whole Topic id. A field path such as `time.warp.warpRate` is not a
 * Topic and reads `"delayed"`; split it first with
 * {@link splitRawFieldSubtopic}.
 *
 * @category Delay and vantage
 */
export function delayLaneOf(
  topic: string,
  roles: DeclaredDelayRoles = GENERATED_ROLES,
): DelayLane {
  if (
    roles.trueNow.has(topic) ||
    roles.heldAtHome.has(topic) ||
    roles.addressed.has(topic)
  ) {
    return "true-now";
  }
  return roles.trueNowPrefixes.some((prefix) => topic.startsWith(prefix))
    ? "true-now"
    : "delayed";
}
