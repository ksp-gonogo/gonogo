/**
 * How a widget-facing key resolves to the stream Topic it reads from.
 *
 * Two independent concerns live here.
 *
 * 1. **`redirectKinematicSubtopic`**: a narrow, sourceId-agnostic safety net
 *    that redirects a handful of raw topic strings onto the derived
 *    `vessel.state.*` surface, so nothing that already speaks the topic
 *    namespace can reintroduce the dual-altitude wart. Identity fallback, so it
 *    is safe to call on any topic string.
 * 2. **`isKnownFieldPath` / `resolveValueTopic`**: whether a dotted path names
 *    a field the contract declares, and which Topic a caller should sample for
 *    it. Both read the contract's own generated metadata through
 *    `unitsForTopic`/`shapesForTopic`, so a Topic an Uplink or a derived
 *    channel registered at module load resolves alongside a first-party one.
 *
 * `mapTopic` survives for `sourceId === "kos"` alone. The mod publishes native
 * `kos.processors` push telemetry plus the dynamic `kos.compute.<id>.<field>`
 * namespace, so those Topics genuinely exist on the wire and the widget-facing
 * key IS the wire topic. Every other source is deliberately NOT routed: mapping
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

/** Kinematics → `vessel.state.*` routing: `mapTopic` points kinematics at
 * `vessel.state.*` derived subtopics from the first migrated widget. Two
 * input shapes are handled:
 * - **Short semantic keys** (`"altitude"`, `"velocity"`, `"position"`,
 *   `"orbitalSpeed"`): forward-compatible shorthand some SDK-native callers
 *   may use.
 * - **Raw topic strings a widget might reach for directly**,
 *   `"vessel.flight.altitudeAsl"` is redirected to `"vessel.state.altitudeAsl"`
 *   even though the raw field genuinely exists on the wire, because binding a
 *   widget straight to it reproduces the dual-altitude wart `vessel.state`
 *   exists to kill. Same story for `"vessel.flight.orbitalSpeed"` →
 *   `"vessel.state.orbitalSpeed"`: `vessel.flight` carries `orbitalSpeed` on
 *   the wire; `vessel.orbit` is elements-only and has no such field, so a
 *   redirect keyed on that topic would never fire.
 *   Non-kinematic keys (surface-frame-only measurements with no
 *   elements-derived twin, e.g. `vessel.flight.mach`,
 *   `vessel.flight.dynamicPressureKPa`) are deliberately NOT redirected,
 *   those stay raw; there's no dual representation to collapse.
 */
const KINEMATIC_REDIRECTS: Readonly<Record<string, string>> = {
  position: "vessel.state.position",
  velocity: "vessel.state.velocity",
  altitude: "vessel.state.altitudeAsl",
  altitudeAsl: "vessel.state.altitudeAsl",
  orbitalSpeed: "vessel.state.orbitalSpeed",
  "vessel.flight.altitudeAsl": "vessel.state.altitudeAsl",
  "vessel.flight.orbitalSpeed": "vessel.state.orbitalSpeed",
};

/**
 * Resolve a *new-SDK* topic string to the topic it should actually be read
 * from. Kinematics (position/velocity/altitude/orbital speed) always
 * resolve to `vessel.state.*`; everything else passes through unchanged.
 * Identity fallback: safe to call on every topic, not just kinematic ones.
 */
export function redirectKinematicSubtopic(topic: string): string {
  return KINEMATIC_REDIRECTS[topic] ?? topic;
}

/**
 * `kos.compute.<id>.<field>`: the dynamic centralised-compute namespace.
 * Identity-mapped so a future compute-feed slice reads straight off the
 * stream; `.status` sub-topics and `.dispatchNow`/`.reEnable` command keys
 * are deliberately excluded (status has no producer on this table; commands
 * never route through `useDataValue`).
 */
const KOS_COMPUTE_FIELD = /^kos\.compute\.[\w-]+\.[\w-]+$/;
const KOS_COMPUTE_NON_VALUE =
  /^kos\.compute\.[\w-]+\.(status|dispatchNow|reEnable)$/;

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
 * The stream Topic a `(dataSourceId, key)` pair reads from.
 *
 * Every surviving entry is an IDENTITY map over a DYNAMIC namespace: a family of
 * Topics materialised per subject at runtime, so no `[SitrepTopic]` type names
 * one and nothing generated can enumerate them. The widget-facing key IS the
 * wire topic in each case; what this answers is whether the key belongs to a
 * namespace the mod actually publishes.
 *
 * That is why these outlived the retired flat vocabulary rather than going with
 * it. A flat key was a NAME FOR something the wire calls otherwise, and there is
 * nothing left to translate. A dynamic key needs no translation and cannot be
 * enumerated, so a pattern is the only thing that can vouch for it.
 *
 * `undefined` for a kOS key that names no value: a `.status` sub-topic has no
 * producer here, and `.dispatchNow` / `.reEnable` are commands, which never
 * resolve through a read.
 */
export function mapTopic(
  dataSourceId: string,
  key: string,
): string | undefined {
  if (dataSourceId === "kos") {
    if (key === "kos.processors") return "kos.processors";
    if (KOS_COMPUTE_NON_VALUE.test(key)) return undefined;
    if (KOS_COMPUTE_FIELD.test(key)) return key;
    return undefined;
  }

  if (dataSourceId !== "data") return undefined;
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

  let units: Readonly<Record<string, string>> = unitsForTopic(topic as never);
  let shapes: Readonly<Record<string, string>> = shapesForTopic(topic as never);
  if (isEmpty(units) && isEmpty(shapes)) return false;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const last = i === segments.length - 1;

    if (units[segment] !== undefined) {
      // A unit is a leaf, so anything after it is not a field.
      return last;
    }

    // A vector's unit sits on a DOTTED leaf key (`"relativePosition.x"`) rather
    // than on a nested shape, because the shared vector type carries no unit of
    // its own and the components are what a reader indexes. Consuming one
    // segment at a time can never match one, so the whole remainder is tried as
    // a single key. The read resolves such a path by walking into the payload,
    // which is why refusing it here would reject a field that works.
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
 * Whether `path` names a field the contract declares under one of its Topics.
 *
 * Read entirely off the contract's own generated metadata, through
 * `unitsForTopic`/`shapesForTopic` rather than the generated maps directly. That
 * indirection is what lets it see a Topic registered at module load: an Uplink's
 * relocated payload type, and every client-derived channel, which is computed
 * here and appears in no contract type at all. Reading the maps directly was
 * blind to both, and `vessel.state.*` only resolved because a migration table
 * happened to list those paths.
 */
export function isKnownFieldPath(path: string): boolean {
  // Topic ids contain dots, so the split point is found rather than assumed:
  // the longest prefix the contract knows as a topic wins.
  const segments = path.split(".");
  for (let cut = segments.length - 1; cut >= 1; cut--) {
    const topic = segments.slice(0, cut).join(".");
    if (
      isEmpty(unitsForTopic(topic as never)) &&
      isEmpty(shapesForTopic(topic as never))
    ) {
      continue;
    }
    if (walksContractMetadata(topic, segments.slice(cut))) return true;
  }
  return false;
}

/**
 * The Topic a picked key reads from, for the two vocabularies that currently
 * coexist.
 *
 * A key from the retiring flat vocabulary goes through the migration table
 * above. A key from the field-path vocabulary IS the path it reads, so it needs
 * no translation and only needs vouching for: the picker offers paths the
 * contract declares, and a path it does not declare resolves to nothing rather
 * than to a subscription no channel serves.
 *
 * Both arms are here so that the two readers of a picked key (the threshold
 * evaluators and the note-tag resolver) agree on what a key means. When the flat
 * vocabulary goes, the first arm goes with it and this becomes the vouch alone.
 */
export function resolveValueTopic(
  dataSourceId: string,
  key: string,
): string | undefined {
  const mapped = mapTopic(dataSourceId, key);
  if (mapped !== undefined) return mapped;
  return isKnownFieldPath(key) ? key : undefined;
}
