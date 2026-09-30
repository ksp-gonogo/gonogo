import {
  dynamicPrefixOf,
  isRuntimeRegisteredTopic,
  noteSplitHandedOut,
} from "./runtime-topic-registry";
import { TOPIC_IDS } from "./topics";

/** Every Topic id this SDK knows statically: the generated ids plus the engine-owned hand-declared tail. */
const KNOWN_TOPIC_IDS: ReadonlySet<string> = new Set<string>(TOPIC_IDS);

const isKnownTopicId = (id: string) =>
  KNOWN_TOPIC_IDS.has(id) || isRuntimeRegisteredTopic(id);

/**
 * What a dotted key resolves to: the wire Topic, and the path within its payload.
 *
 * @category Reading telemetry
 */
export interface RawFieldSubtopic {
  rawTopic: string;
  fieldPath: string[];
}

/**
 * Splits a dotted key into the REAL raw wire Topic and a nested field path into
 * that record's payload, at the LONGEST KNOWN Topic id the key starts with: the
 * SDK's own ids and every id a client package has registered. `undefined` when
 * the key IS a whole Topic and hangs no field off anything: it is itself a known
 * Topic id, it sits under a registered dynamic prefix and no known id, or it has
 * fewer than three segments (a raw channel is `domain.channel`, so `"vessel.orbit"` is the
 * Topic rather than a field of some `"vessel"` record).
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
 * every synthetic test topic rely on, and which is also the right split for a
 * Topic this build has never heard of.
 *
 * A key read before its client package registered the Topic or prefix it sits
 * under is split the fallback way, and the registration that arrives later is
 * refused loudly (see `registerDynamicTopicPrefix`) rather than left to resolve
 * the same key two ways in one session.
 *
 * @category Reading telemetry
 */
export function splitRawFieldSubtopic(
  topic: string,
): RawFieldSubtopic | undefined {
  const segments = topic.split(".");
  if (segments.length < 3) return undefined;

  for (let take = segments.length; take >= 2; take--) {
    const candidate = segments.slice(0, take).join(".");
    if (!isKnownTopicId(candidate)) continue;
    // The whole key is a Topic in its own right: nothing hangs off it.
    if (take === segments.length) return undefined;
    return handOut(topic, candidate, segments.slice(take));
  }

  // After the known ids, so a fixed Topic under a dynamic prefix (`fleet.silence` under `fleet.`) still has fields.
  if (dynamicPrefixOf(topic) !== undefined) return undefined;

  return handOut(topic, `${segments[0]}.${segments[1]}`, segments.slice(2));
}

function handOut(
  key: string,
  rawTopic: string,
  fieldPath: string[],
): RawFieldSubtopic {
  noteSplitHandedOut(key, rawTopic);
  return { rawTopic, fieldPath };
}
