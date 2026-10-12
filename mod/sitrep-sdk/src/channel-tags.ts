// How each published value relates in time, resolved for one Topic and path.
//
// A channel states its kind on its declaration; a value inside it may state its
// own with [SitrepSampleKind], and the nearest one on a path wins. The running
// mod sends every channel's kind on `system.uplinks`; the table generated from
// core's declarations answers before that arrives.

import { GENERATED_CHANNEL_KINDS } from "./__generated__/sample-kinds";
import { type SampleKind, valueTagsOf } from "./contract-tags";
import type { TopicId } from "./topics";
import {
  isPluralShape,
  type SitrepUnit,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  staticsForTopic,
  staticsForType,
  unitsForTopic,
  unitsForType,
} from "./units";

/**
 * How the running mod says each channel's samples relate in time, as carried
 * on the `sampleKinds` field of `system.uplinks`. Useful for working out, before
 * a value arrives, whether a channel's values are continuous, discrete or
 * events. Returned by {@link readDeclaredSampleKinds} and taken by
 * {@link channelKindOf} and {@link sampleKindOf}.
 *
 * @category Channels
 */
export interface DeclaredSampleKinds {
  /** Each static channel's kind. */
  readonly topics: ReadonlyMap<string, SampleKind>;
  /** Each dynamic namespace's kind, which every Topic under it shares. */
  readonly prefixes: readonly (readonly [string, SampleKind])[];
}

function isSampleKind(value: unknown): value is SampleKind {
  return value === "continuous" || value === "discrete" || value === "event";
}

function kindsOf(value: unknown): [string, SampleKind][] | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, SampleKind] => isSampleKind(entry[1]),
  );
}

/**
 * Returns the {@link DeclaredSampleKinds} carried on a `system.uplinks`
 * payload, or `undefined` when it carries none. Useful for noticing what the
 * running mod says about each channel as soon as the Uplink roster arrives. Used
 * by the stream's timeline store.
 *
 * @category Channels
 */
export function readDeclaredSampleKinds(
  rosterPayload: unknown,
): DeclaredSampleKinds | undefined {
  if (rosterPayload === null || typeof rosterPayload !== "object") {
    return undefined;
  }
  const block = (rosterPayload as { sampleKinds?: unknown }).sampleKinds;
  if (block === null || typeof block !== "object") return undefined;
  const raw = block as Record<string, unknown>;
  const topics = kindsOf(raw.topics);
  const prefixes = kindsOf(raw.prefixes);
  if (!topics || !prefixes) return undefined;
  return {
    topics: new Map(topics),
    prefixes: prefixes.sort(([a], [b]) => b.length - a.length),
  };
}

/**
 * The kind a channel declares, from the mod's roster where it has arrived and
 * from core's own declarations before then, or `undefined` for a channel
 * neither knows. Useful for deciding whether a channel's values are held until
 * the next sample or drawn between samples. Used by the stream's timeline store.
 *
 * @category Channels
 */
export function channelKindOf(
  topic: string,
  declared?: DeclaredSampleKinds,
): SampleKind | undefined {
  if (declared) {
    const own = declared.topics.get(topic);
    if (own) return own;
    for (const [prefix, kind] of declared.prefixes) {
      if (topic.startsWith(prefix)) return kind;
    }
  }
  return (GENERATED_CHANNEL_KINDS as Readonly<Record<string, SampleKind>>)[
    topic
  ];
}

/**
 * Units whose values are never points on a line, so a value carrying one
 * stands until the next sample whatever its channel says: a flag, an id, a
 * name, an enum member, a count and an instant.
 */
const NEVER_BETWEEN: ReadonlySet<SitrepUnit> = new Set([
  "flag",
  "id",
  "text",
  "enum",
  "count",
  "ut",
]);

function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * The declared unit at a path inside a Topic's payload, and whether it is
 * declared static, walking nested shapes. An index into a list is skipped, as
 * is the key after a dictionary.
 */
function unitAt(
  topic: string,
  path: readonly string[],
): { unit: SitrepUnit | undefined; isStatic: boolean } {
  let units = unitsForTopic(topic as TopicId);
  let shapes = shapesForTopic(topic as TopicId);
  let statics = staticsForTopic(topic as TopicId);
  let i = 0;
  while (i < path.length) {
    const segment = path[i];
    if (isIndex(segment)) {
      i++;
      continue;
    }
    // Joined from here on, so a vector's dotted leaf (`relativePosition.x`) is found where its unit is declared.
    const rest = path.slice(i).join(".");
    if (units[rest] !== undefined) {
      return { unit: units[rest], isStatic: statics.includes(rest) };
    }
    const entry = shapes[segment];
    if (entry === undefined) {
      return { unit: undefined, isStatic: statics.includes(rest) };
    }
    const type = shapeTypeName(entry);
    units = unitsForType(type);
    shapes = shapesForType(type);
    statics = staticsForType(type);
    i += isPluralShape(entry) && entry.startsWith("*") ? 2 : 1;
  }
  return { unit: undefined, isStatic: false };
}

/**
 * The value tag the nearest declaration on `path` makes, an index or
 * dictionary key matching the `*` the tag was declared under.
 */
function nearestValueKind(
  topic: string,
  path: readonly string[],
): Exclude<SampleKind, "event"> | undefined {
  const tags = valueTagsOf(topic);
  if (!tags) return undefined;
  for (let take = path.length; take > 0; take--) {
    for (const [declared, value] of tags.paths) {
      if (value.kind === undefined) continue;
      const pattern = declared.split(".");
      if (pattern.length !== take) continue;
      if (pattern.every((part, i) => part === "*" || part === path[i])) {
        return value.kind;
      }
    }
  }
  return undefined;
}

/**
 * How the value at `path` inside `topic` relates in time. Useful for deciding
 * whether a plotted or displayed value is held until the next sample or
 * interpolated between samples. Used by the stream's timeline store. The kind
 * is decided in this order:
 *
 * 1. an Event channel's every value is an event
 * 2. otherwise the nearest `[SitrepSampleKind]` on the path, then the
 *    channel's own kind, and `continuous` for a channel nothing declares
 * 3. a value whose kind comes from its channel, and would be continuous, is
 *    discrete when its unit is a flag, an id, text, an enum member, a count or
 *    an instant, or when it is static. A value's own declaration is never
 *    second-guessed: an orbit's epoch is an instant a model moves smoothly
 *
 * @category Channels
 */
export function sampleKindOf(
  topic: string,
  path: readonly string[] = [],
  declared?: DeclaredSampleKinds,
): SampleKind {
  const channel = channelKindOf(topic, declared);
  if (channel === "event") return "event";
  const own = nearestValueKind(topic, path);
  if (own !== undefined) return own;
  const kind = channel ?? "continuous";
  if (kind !== "continuous" || path.length === 0) return kind;
  const { unit, isStatic } = unitAt(topic, path);
  return isStatic || (unit !== undefined && NEVER_BETWEEN.has(unit))
    ? "discrete"
    : "continuous";
}
