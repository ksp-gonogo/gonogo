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
 * A dotted key split into the Topic it belongs to and the path of the field
 * within that Topic's payload. {@link splitRawFieldSubtopic} returns one.
 *
 * @category Reading telemetry
 */
export interface RawFieldSubtopic {
  /** The Topic id, such as `"vessel.flight"`. */
  rawTopic: string;
  /** The field path inside the payload, one segment per entry, such as `["altitudeAsl"]`. */
  fieldPath: string[];
}

/**
 * Splits a dotted key into a Topic and the field path under it, or returns
 * `undefined` when the key is a whole Topic.
 *
 * The Topic is the longest known Topic id the key starts with, counting ids
 * an Uplink has registered, so `"alarm.scet.fired.firedAtUt"` splits into
 * `alarm.scet.fired` and `["firedAtUt"]`. A key under no known id splits after
 * its second segment.
 *
 * It returns `undefined` for a key that is itself a known Topic id, one under
 * a prefix registered with {@link registerDynamicTopicPrefix}, and one of
 * fewer than three segments.
 *
 * A Topic or prefix registered after a key under it has been split throws, so
 * register them when the client package loads.
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
