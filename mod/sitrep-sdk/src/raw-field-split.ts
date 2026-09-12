import { TOPIC_IDS } from "./topics";

/**
 * Every Topic id this SDK knows statically: the generated ids plus the
 * engine-owned hand-declared tail. Uplink-registered ids are deliberately NOT
 * consulted (see {@link splitRawFieldSubtopic}).
 */
const KNOWN_TOPIC_IDS: ReadonlySet<string> = new Set<string>(TOPIC_IDS);

/** What a dotted key resolves to: the wire Topic, and the path within its payload. */
export interface RawFieldSubtopic {
  rawTopic: string;
  fieldPath: string[];
}

/**
 * Splits a dotted key into the REAL raw wire Topic and a nested field path into
 * that record's payload, at the LONGEST KNOWN Topic id the key starts with.
 * `undefined` when the key IS a whole Topic and hangs no field off anything:
 * either it is itself a known Topic id, or it has fewer than three segments (a
 * raw channel is `domain.channel`, so `"vessel.orbit"` is the Topic rather than
 * a field of some `"vessel"` record).
 *
 * Longest-match rather than "always after the second segment", which is what
 * this did until the three genuinely-3-segment Topics in the contract
 * (`alarm.scet.fired`, `vessel.orbit.truth`, `vessel.physics.mode`) showed the
 * cost of: each resolved to a 2-segment parent no channel publishes, so reading
 * one sampled nothing and subscribing to one starved the subscription, and a
 * field path under one could not be addressed at all. `alarm.scet.fired` is the
 * sharp case: the contract annotates both its fields, and
 * `alarm.scet.fired.firedAtUt` still split into `alarm.scet` (an ARRAY) plus a
 * `fired.firedAtUt` path no record has.
 *
 * A key under no known Topic falls back to the historical
 * `<domain>.<channel>.<field...>` split, which is what a legacy flat key and
 * every synthetic test topic rely on, and which is also the honest answer for a
 * Topic this build has never heard of.
 *
 * ── What this does NOT subsume ──────────────────────────────────────────────
 * A DYNAMIC namespace (a per-vessel, per-part or per-(body,type) Topic resolved
 * at runtime) has no fixed member in any generated list by construction, so it
 * cannot be recognised here however long the match. Those stay with the
 * caller's own prefix mechanism (`TimelineStore`'s `dynamicWholeTopicPrefixes`),
 * which is consulted BEFORE this function. For the same reason the runtime
 * registry an Uplink self-registers into is not read here: it fills in after the
 * app has rendered, and a split that changed answer when a bundle loaded would
 * resolve one subscription differently from the next. No Uplink ships a
 * 3-segment Topic today; one that did would declare a prefix, as the dynamic
 * namespaces already do.
 */
export function splitRawFieldSubtopic(
  topic: string,
): RawFieldSubtopic | undefined {
  const segments = topic.split(".");
  if (segments.length < 3) return undefined;

  for (let take = segments.length; take >= 2; take--) {
    const candidate = segments.slice(0, take).join(".");
    if (!KNOWN_TOPIC_IDS.has(candidate)) continue;
    // The whole key is a Topic in its own right: nothing hangs off it.
    if (take === segments.length) return undefined;
    return { rawTopic: candidate, fieldPath: segments.slice(take) };
  }

  return {
    rawTopic: `${segments[0]}.${segments[1]}`,
    fieldPath: segments.slice(2),
  };
}
