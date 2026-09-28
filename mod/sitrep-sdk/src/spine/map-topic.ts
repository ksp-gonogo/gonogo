/**
 * How a widget-facing key resolves to the stream Topic it reads from.
 *
 * `isKnownFieldPath` / `resolveValueTopic` say whether a dotted path names a
 * field the contract declares, and which Topic a caller should sample for it.
 * Both read the contract's own generated metadata through
 * `unitsForTopic`/`shapesForTopic`, so a Topic an Uplink or a derived channel
 * registered at module load resolves alongside a first-party one.
 *
 * `mapTopic` vouches for a key in a DYNAMIC namespace, which no generated
 * metadata can enumerate. Every other key is deliberately NOT routed: mapping
 * one would point a read at a Topic nothing publishes.
 */

import {
  isPluralShape,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  unitsForTopic,
  unitsForType,
} from "../units";

/**
 * Namespace PREFIXES (each ends in `.`) whose member topics are keyed by
 * something the contract never names up front: a body and a scan type, a
 * vessel guid, a part's flight id. `TimelineStore`'s `dynamicWholeTopicPrefixes`
 * resolves a topic under one of these to its IDENTITY, a whole raw wire topic,
 * rather than mis-splitting it into a `<domain.channel>.<fieldPath>` that is
 * never published.
 *
 * The SCANsat entries are exactly `ScanChannels.{Coverage,Mask,Height,Biome,
 * Anomalies}Prefix` in that Uplink's mod, and its `scansat-wire-contract` test
 * asserts the two lists stay equal. A real wire topic never ends in `.`, so a
 * prefix never collides with an exact topic id.
 *
 * @category Reading telemetry
 */
export const DYNAMIC_WHOLE_TOPIC_PREFIXES: readonly string[] = [
  "scansat.coverage.",
  "scansat.mask.",
  "scansat.height.",
  "scansat.biome.",
  "scansat.anomalies.",
  // fleet.<guid>.orbit, fleet.<guid>.delay and fleet.<guid>.contact. One prefix
  // carries the whole per-vessel namespace, so the store timelines each
  // vessel's delayed elements, link and core-contact facts and useStream
  // samples them into a dead-reckoned fleet position and FleetRoster's per-row
  // delay.
  "fleet.",
  // silence.<guid>.state, the comms-owned SilenceTracker reckoning for one
  // vessel. It gets a namespace of its own rather than joining fleet. above
  // because the core fleet facts and the comms model's opinion of them are
  // separately owned (see mod/Sitrep.Host/ChannelEngine.cs's
  // SilenceEventPrefix).
  "silence.",
  // currency.<guid>.science (+ .reputation): source-attributed currency events,
  // revealed at their source vessel's own light-time. One prefix covers the whole
  // per-vessel namespace, same as fleet. above.
  "currency.",
  // vessel.partActions.<flightId>: the per-part PAW action lists (mod's
  // PartActionsViewProvider.TopicPrefix). One prefix covers every part, which is
  // the only workable form here: the keys are per-part and only ever computed at
  // interaction time, so they cannot be enumerated up front. The mod only
  // PRODUCES a part's channel while that part is subscribed, so covering the
  // whole prefix costs nothing for parts nobody has open.
  "vessel.partActions.",
];

/**
 * `scansat.coverage.<body>.<type>` / `scansat.mask.<body>.<type>` /
 * `scansat.height.<body>` / `scansat.biome.<body>` / `scansat.anomalies.<body>`:
 * the per-body namespaces `ScansatUplink.Sample` publishes.
 */
const SCANSAT_DYNAMIC =
  /^scansat\.(coverage|mask)\.\w+\.\d+$|^scansat\.(height|biome|anomalies)\.\w+$/;

/** `vessel.partActions.<flightId>`: the per-part PAW namespace `VesselUplink` publishes. */
const PART_ACTIONS_DYNAMIC = /^vessel\.partActions\.\d+$/;

/**
 * The stream Topic a dynamic-namespace key reads from.
 *
 * Every surviving entry is an IDENTITY map over a DYNAMIC namespace: a family of
 * Topics materialised per subject at runtime, so no `[SitrepTopic]` type names
 * one and nothing generated can enumerate them. The widget-facing key IS the
 * wire topic in each case; what this decides is whether the key belongs to a
 * namespace the mod actually publishes.
 *
 * A dynamic key needs no translation and cannot be
 * enumerated, so a pattern is the only thing that can vouch for it.
 *
 * @category Stream fixture
 */
export function mapTopic(key: string): string | undefined {
  if (SCANSAT_DYNAMIC.test(key)) return key;
  if (PART_ACTIONS_DYNAMIC.test(key)) return key;
  return undefined;
}

/**
 * Walks the contract's own generated metadata from a topic root down a dotted
 * path, returning whether every segment names a real field.
 *
 * A field is real when the topic (or the type reached so far) declares it with
 * a UNIT, or declares it as a nested contract TYPE, which is the two halves the
 * unit-map codegen emits from one pass.
 *
 * A PLURAL shape (`*Type` for a dynamic-key map, `Type[]` for a list) ends the
 * walk rather than being descended into: what follows a map is a key the
 * contract never names (a facility id, a vessel id), and what follows a list is
 * a field of one element, so neither is something a sample of the parent Topic
 * can reach. The path AS FAR AS the collection is still a real field and still
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
 * Whether the contract declares `topic` as a Topic at all.
 *
 * Read off the generated metadata through `unitsForTopic`/`shapesForTopic` for
 * the same reason {@link isKnownFieldPath} does: that indirection is what sees
 * a Topic registered at module load, which an Uplink's own payload type and
 * every client-derived channel only ever are.
 *
 * Distinct from {@link isKnownFieldPath}, and the distinction is a real one for
 * a caller: the reads keyed by a whole Topic (a status, a plotted window) and
 * the reads keyed by a field path within one are different vocabularies, and a
 * key valid in one is not valid in the other.
 */
export function isKnownTopic(topic: string): boolean {
  return !(
    isEmpty(unitsForTopic(topic as never)) &&
    isEmpty(shapesForTopic(topic as never))
  );
}

/**
 * Whether `path` names a field the contract declares under one of its Topics.
 *
 * Read entirely off the contract's own generated metadata, through
 * `unitsForTopic`/`shapesForTopic` rather than the generated maps directly. That
 * indirection is what lets it see a Topic registered at module load: an Uplink's
 * own payload type, and every client-derived channel, which is computed here
 * and appears in no contract type at all. Reading the maps directly is blind to
 * both.
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
 * The Topic a picked key reads from. A key in a dynamic namespace is vouched
 * for by {@link mapTopic}; a field path IS the path it reads, so it needs no
 * translation and only needs vouching for: the picker offers paths the contract
 * declares, and a path it does not declare resolves to nothing rather than to a
 * subscription no channel serves.
 *
 * One function so that the readers of a picked key (the threshold evaluators
 * and the note-tag resolver) agree on what a key means.
 */
export function resolveValueTopic(key: string): string | undefined {
  const mapped = mapTopic(key);
  if (mapped !== undefined) return mapped;
  return isKnownFieldPath(key) ? key : undefined;
}
