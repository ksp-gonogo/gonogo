/**
 * How a widget-facing key resolves to the stream Topic it reads from.
 *
 * `isKnownFieldPath` / `resolveValueTopic` say whether a dotted path names a
 * field the contract declares, and which Topic a caller should sample for it.
 * Both read the contract's own generated metadata through
 * `unitsForTopic`/`shapesForTopic`, so a Topic an Uplink or a derived channel
 * registered at module load resolves alongside a first-party one.
 *
 * `mapTopic` vouches for a key in a dynamic namespace, which no generated
 * metadata can enumerate. Every other key is deliberately not routed: mapping
 * one would point a read at a Topic nothing publishes.
 */

import { dynamicPrefixOf } from "../runtime-topic-registry";
import {
  isPluralShape,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  unitsForTopic,
  unitsForType,
} from "../units";

export { DYNAMIC_WHOLE_TOPIC_PREFIXES } from "../runtime-topic-registry";

/** `vessel.partActions.<flightId>`: the per-part PAW namespace `VesselUplink` publishes, keyed by a numeric flight id. */
const PART_ACTIONS_PREFIX = "vessel.partActions.";
const PART_ACTIONS_DYNAMIC = /^vessel\.partActions\.\d+$/;

/**
 * The Topic a dynamic key is read from, or `undefined` when the key is under
 * no registered prefix. A dynamic key, such as one per body or per part, is its
 * own Topic; what this checks is that some code registered its prefix with
 * `registerDynamicTopicPrefix`. Useful for reading a value the operator picked
 * from a per-body or per-part namespace. Used by `resolveValueTopic`.
 *
 * @category Stream fixture
 */
export function mapTopic(key: string): string | undefined {
  const prefix = dynamicPrefixOf(key);
  if (prefix === undefined) return undefined;
  if (prefix === PART_ACTIONS_PREFIX && !PART_ACTIONS_DYNAMIC.test(key)) {
    return undefined;
  }
  return key;
}

/**
 * Walks the contract's own generated metadata from a topic root down a dotted
 * path, returning whether every segment names a real field.
 *
 * A field is real when the topic (or the type reached so far) declares it with
 * a unit, or declares it as a nested contract type, which is the two halves the
 * unit-map codegen emits from one pass.
 *
 * A plural shape (`*Type` for a dynamic-key map, `Type[]` for a list) ends the
 * walk rather than being descended into: what follows a map is a key the
 * contract never names (a facility id, a vessel id), and what follows a list is
 * a field of one element, so neither is something a sample of the parent Topic
 * can reach. The path as far as the collection is still a real field and still
 * resolves.
 */
function walksContractMetadata(topic: string, segments: string[]): boolean {
  if (segments.length === 0) return false;

  if (!isKnownTopic(topic)) return false;
  let units: Readonly<Record<string, string>> = unitsForTopic(topic as never);
  let shapes: Readonly<Record<string, string>> = shapesForTopic(topic as never);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const last = i === segments.length - 1;

    if (units[segment] !== undefined) {
      // A unit is a leaf, so anything after it is not a field.
      return last;
    }

    /*
     * A vector's unit sits on a DOTTED leaf key (`"relativePosition.x"`) rather
     * than on a nested shape, because the shared vector type carries no unit of
     * its own and the components are what a reader indexes. Consuming one
     * segment at a time can never match one, so the whole remainder is tried as
     * a single key. The read resolves such a path by walking into the payload,
     * which is why refusing it here would reject a field that works.
     */
    if (!last && units[segments.slice(i).join(".")] !== undefined) return true;

    const shape: string | undefined = shapes[segment];
    if (shape === undefined) return false;
    if (last) return true;
    if (isPluralShape(shape)) return false;

    const nested = shapeTypeName(shape);
    units = unitsForType(nested);
    shapes = shapesForType(nested);
    if (isEmpty(units) && isEmpty(shapes)) return false;
  }

  return false;
}

function isEmpty(record: Readonly<Record<string, unknown>>): boolean {
  for (const _ in record) return false;
  return true;
}

/**
 * Whether the contract declares `topic` as a Topic at all, including a Topic
 * registered at module load such as an Uplink's own or a client-derived channel.
 * Useful for checking a Topic the operator or a widget names before reading it.
 *
 * It differs from {@link isKnownFieldPath}: reads keyed by a whole Topic (a
 * status, a plotted window) and reads keyed by a field path within one are
 * different vocabularies, and a key valid in one is not valid in the other.
 */
export function isKnownTopic(topic: string): boolean {
  return !(
    isEmpty(unitsForTopic(topic as never)) &&
    isEmpty(shapesForTopic(topic as never))
  );
}

/**
 * Whether `path` names a field the contract declares under one of its Topics,
 * including a Topic registered at module load such as an Uplink's own payload
 * type or a client-derived channel. Useful for checking a field path the
 * operator picked before reading it. Used by the core when it classifies what a
 * widget declares it reads.
 */
export function isKnownFieldPath(path: string): boolean {
  // Topic ids contain dots, so the split point is found rather than assumed: the longest prefix the contract knows as a topic wins.
  const segments = path.split(".");
  for (let cut = segments.length - 1; cut >= 1; cut--) {
    const topic = segments.slice(0, cut).join(".");
    if (!isKnownTopic(topic)) continue;
    if (walksContractMetadata(topic, segments.slice(cut))) return true;
  }
  return false;
}

/**
 * The Topic that a key the operator picked reads from, or `undefined` when the
 * key resolves to none. Useful for reading a field the operator chose, such as
 * for a threshold or a note tag. Used by the note tag values hook and by the
 * threshold evaluators.
 *
 * A key in a dynamic namespace resolves through {@link mapTopic}. A field path
 * is its own Topic path and needs no translation: it resolves when the contract
 * declares it, and a path it does not declare resolves to `undefined`.
 */
export function resolveValueTopic(key: string): string | undefined {
  const mapped = mapTopic(key);
  if (mapped !== undefined) return mapped;
  return isKnownFieldPath(key) ? key : undefined;
}
