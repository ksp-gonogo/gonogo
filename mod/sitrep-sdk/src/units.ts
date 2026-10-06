// Runtime unit lookup for wire-payload fields.
//
// ── The hole this closes ────────────────────────────────────────────────────────────
// The app displays units everywhere, and without this none of them come from the data.
// `Sitrep.Contract` can state a unit only as English prose inside a `<summary>` doc
// comment, which for most fields it does not, and prose reaches no client: without the
// attribute below the generated SDK carries no unit metadata at all. Each widget is then
// left to hand-roll its own literal, duplicated scaling ladders included, and the other
// machine-readable unit table in the repo is keyed by LEGACY keys (`v.altitude`) that the
// live topic path does not speak.
//
// ── The mechanism ───────────────────────────────────────────────────────────────────
// A `[SitrepUnit(Units.MetresPerSecond)]` attribute on the C# property is the source of
// truth. `mod/codegen.sh` (via `RtConfig.EmitUnitMap`) reflects over those attributes
// and emits `./__generated__/units.ts`. This file is the hand-written accessor on top:
// the generated maps are plain data, and these helpers are what a consumer should
// actually call, so the generated shape stays free to change.
//
// ── Every scalar field declares something ───────────────────────────────────────────
// This inverts the rule the mechanism shipped with ("only annotate what is KNOWN",
// absence means not-yet-stated). Absence was not a cautious default but an
// unfalsifiable one: a new unannotated number looked exactly like a boolean that never
// needed annotating, so nothing could be enforced and coverage stalled at a fifth of
// the surface. The non-quantities now have tokens of their own (`count`, `id`, `text`,
// `flag`, `enum`, and `n/a` as a last resort), and `UnitCoverageTests` in
// `Sitrep.Core.Tests` holds the line against a baseline that may only shrink.
//
// So `undefined` now means one of exactly two things: a STRUCTURAL property (a nested
// payload or a list of them, described entirely by the units on its leaves), or a field
// still in that shrinking baseline. It has never meant "dimensionless": a genuinely
// dimensionless quantity (Mach, eccentricity) carries the explicit `"1"` token, a 0..1
// fraction carries `"ratio"`, and a declared non-quantity carries `"n/a"`. A formatter
// must treat all of those differently, which is why they are distinct values.

import type {
  EnumsByField,
  KnownSitrepUnit,
  ShapesByField,
  SitrepUnit,
  UnitsByField,
} from "./__generated__/units";
import {
  GENERATED_ENUM_MEMBERS,
  GENERATED_TOPIC_ENUMS,
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_STATICS,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_DETERMINISTIC_WHILE,
  GENERATED_TYPE_ENUMS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_STATICS,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
import { noteRuntimeTopicMetadata } from "./runtime-topic-registry";
import type { TopicId } from "./topics";

export type {
  EnumsByField,
  KnownSitrepUnit,
  ShapesByField,
  SitrepUnit,
  UnitsByField,
};

const EMPTY: UnitsByField = Object.freeze({});
const NO_SHAPES: ShapesByField = Object.freeze({});
const NO_STATICS: readonly string[] = Object.freeze([]);
const NO_ENUMS: EnumsByField = Object.freeze({});

/**
 * Whether a shape-map entry holds MANY of its element type: a leading `*` for
 * a string-keyed dictionary, a trailing `[]` for a list.
 *
 * Plurality decides whether a dotted path under the field can be sampled. What
 * follows a dictionary is a key the contract never names, and what follows a
 * list is a field of one element, so neither is reachable from the parent
 * Topic and a walk has to stop at the collection itself.
 *
 * The marker spelling lives here so the three readers of the shape maps agree
 * on it: the payload wrap, the field-path judgement, and the field enumeration.
 */
export function isPluralShape(entry: string): boolean {
  return entry.startsWith("*") || entry.endsWith("[]");
}

/** The element type named by a shape-map entry, with any plural marker removed. */
export function shapeTypeName(entry: string): string {
  const withoutMap = entry.startsWith("*") ? entry.slice(1) : entry;
  return withoutMap.endsWith("[]") ? withoutMap.slice(0, -2) : withoutMap;
}

/**
 * Hand-declared Topics whose payload IS a reflected contract type.
 *
 * The generated maps are keyed by `[SitrepTopic]`, so an ENGINE-declared
 * channel gets no entry even when its payload is a real contract shape:
 * `ChannelEngine` declares `system.uplink.pending`, not any one Uplink's
 * contract, so nothing in the codegen knows the Topic id. Before this, the
 * type said `Value<"s">` and the runtime handed a bare number, which put the
 * in-transit uplink strip's reach and reply times back to raw seconds and
 * flipped its arrow the wrong way.
 *
 * `topics.ts` is where the hand declaration already lives; this is the same
 * declaration's runtime half. A Topic that gains a `[SitrepTopic]` payload
 * type later stops needing an entry, and the generated map wins either way.
 */
const HAND_DECLARED_PAYLOAD_TYPES: Readonly<Record<string, string>> =
  Object.freeze({
    "system.uplink.pending": "PendingUplinkQueue",
  });

/**
 * Runtime registry of Topic-scoped unit/shape maps for RELOCATED Uplink
 * payload types. `GENERATED_TOPIC_UNITS`/
 * `GENERATED_TOPIC_SHAPES` only know about payload types still reflected out
 * of `Sitrep.Contract`; once a type's Topic moves to its owning Uplink's own
 * contract slice, this SDK's generated map has nothing for it, and
 * `wrapTopicPayload` would silently stop hydrating that Topic's quantities
 * into `Value`s. Mirrors `registerBarePrimitiveTopic`'s self-registration
 * idiom (see `topics.ts`) for the numeric half of the same problem: each
 * relocated Uplink's own client package calls `registerTopicUnits` at module
 * load (fed from ITS OWN generated `units.ts`), alongside its
 * `registerBarePrimitiveTopic`/`declare module TopicPayloadMap` augmentation.
 */
const registeredTopicUnits = new Map<string, UnitsByField>();
const registeredTopicShapes = new Map<string, ShapesByField>();
const registeredTopicStatics = new Map<string, readonly string[]>();
const registeredTopicEnums = new Map<string, EnumsByField>();

/**
 * Registers the units of an Uplink Topic's fields, so its payload's numbers
 * arrive as `Value`s and its fields can be listed. Call it when the Uplink's
 * client package loads, with the maps from the Uplink's own generated
 * `units.ts`, beside {@link registerBarePrimitiveTopic}.
 *
 * `shapes` names the fields that hold another payload type, `statics` the
 * fields whose values never change, and `enums` how each enum field reads as a
 * word. Registering a Topic again replaces what it registered before.
 *
 * Gonogo's own Topics are already known, and registering one changes nothing.
 *
 * @category Units and values
 */
export function registerTopicUnits(
  topic: string,
  units: UnitsByField,
  shapes: ShapesByField = NO_SHAPES,
  statics: readonly string[] = NO_STATICS,
  enums: EnumsByField = NO_ENUMS,
): void {
  registeredTopicUnits.set(topic, units);
  registeredTopicShapes.set(topic, shapes);
  registeredTopicStatics.set(topic, statics);
  registeredTopicEnums.set(topic, enums);
  // Changes what the Topic ENUMERATES without vouching that anything sends it:
  // a client-derived channel declares its fields here too, and nothing puts one
  // on the wire. Which Topics are real is `registerBarePrimitiveTopic`'s
  // answer; see `runtime-topic-registry.ts`.
  noteRuntimeTopicMetadata();
}

/**
 * The TYPE-keyed half of the same registry, and it is not optional the moment a
 * relocated payload has any nesting.
 *
 * `registerTopicUnits` above covers a Topic's OWN fields, which is the whole of
 * the problem for a FLAT relocated type and none of it for a nested one:
 * `wrapTopicPayload` reads `shapesForTopic` to learn that a field holds
 * another shape, then recurses through `wrapTypePayload`, which resolves that
 * shape BY NAME through `unitsForType`/`shapesForType`. Those read the
 * type-keyed generated maps, so a relocated nested type is unreachable from the
 * topic registration alone and its quantities arrive bare while the generated
 * TYPE still says `Value<"m">`.
 *
 * `scansat.scanningVessels` is the case that forced it (the fourth relocation,
 * the first with nesting): its `sensors` field holds `ScanSensorEntry[]`, whose
 * its minimum, maximum and best altitude and field of view are the deepest declared quantities on the
 * SCANsat surface, and `trackColor` holds a `ScanTrackColor`. Registering only
 * the topic would hydrate the vessel's own latitude/longitude/altitude and
 * silently drop every sensor altitude.
 *
 * Last write wins for a given type name, same as the topic registry, so a
 * double import of the same Uplink client is harmless. Type names live in one
 * flat namespace across Uplinks, the same way the generated maps already do;
 * an Uplink should keep its contract type names distinctive (a
 * per-Uplink prefix), which every relocated slice
 * already does.
 */
const registeredTypeUnits = new Map<string, UnitsByField>();
const registeredTypeShapes = new Map<string, ShapesByField>();
const registeredTypeStatics = new Map<string, readonly string[]>();
const registeredTypeEnums = new Map<string, EnumsByField>();
const registeredEnumMembers = new Map<
  string,
  Readonly<Record<number, string>>
>();

/**
 * Registers the units of one of an Uplink's payload types, by its generated
 * type name. Needed for every type nested inside an Uplink Topic's payload,
 * whose numbers otherwise arrive as plain numbers. Call it when the Uplink's
 * client package loads, usually for every type in its generated
 * `GENERATED_TYPE_UNITS`. Registering a type again replaces what it registered
 * before.
 *
 * Type names are shared by every Uplink, so give your types a name unlikely to
 * clash, such as one starting with your Uplink's name.
 *
 * @category Units and values
 */
export function registerTypeUnits(
  typeName: string,
  units: UnitsByField,
  shapes: ShapesByField = NO_SHAPES,
  statics: readonly string[] = NO_STATICS,
  enums: EnumsByField = NO_ENUMS,
): void {
  registeredTypeUnits.set(typeName, units);
  registeredTypeShapes.set(typeName, shapes);
  registeredTypeStatics.set(typeName, statics);
  registeredTypeEnums.set(typeName, enums);
  // Names no Topic, but changes what one enumerates: a nested shape's fields are unreachable until the type it resolves through is registered.
  noteRuntimeTopicMetadata();
}

/**
 * Registers the member names of one of an Uplink's enums, by the enum name
 * that the `enums` of {@link registerTopicUnits} and {@link registerTypeUnits}
 * refer to. Call it when the Uplink's client package loads. Gonogo's own enum
 * of the same name takes precedence.
 *
 * @category Units and values
 */
export function registerEnumMembers(
  enumName: string,
  members: Readonly<Record<number, string>>,
): void {
  registeredEnumMembers.set(enumName, members);
  noteRuntimeTopicMetadata();
}

/**
 * The PROVIDER-EXTENSION half of the same registry: which generated type a
 * provider's namespace inside an `extensions` bag holds.
 *
 * A quantity a provider puts in its namespace is a real `Value<unit>` and has to
 * survive decode like any other, so `wrapTopicPayload` has to be able to walk into
 * the bag. Neither registry above can express that, and not for want of trying:
 *
 *   • `registerTopicUnits` is dead on arrival for an elected capability's Topic.
 *     `unitsForTopic`/`shapesForTopic` return the GENERATED entry FIRST and only
 *     fall back to the registered one, so a provider registering against
 *     `isru.drills` (a core-generated Topic) is silently ignored. Were the
 *     precedence the other way round it would be worse: the maps are whole-Topic,
 *     so last-write-wins between two installed providers would clobber core's own
 *     units for that Topic.
 *   • `registerTypeUnits` resolves BY TYPE NAME, and nothing in the payload names
 *     the provider's type. The bag's values are opaque by construction.
 *
 * So the routing is its own small registry, keyed by (owner, provider id) where
 * `owner` is the Topic id (or the generated type name, for a bag on a nested
 * shape). Two providers extending the same payload write two entries and never
 * collide, which is exactly the property the bag exists for.
 *
 * GENERAL: `owner` is any Topic or type carrying a `[ProviderExtensionBag]`
 * property, so every elected capability's providers register their namespaces
 * the same way with no further core change.
 */
const registeredExtensionShapes = new Map<string, Map<string, string>>();

/**
 * Registers the payload type that one provider puts under its own id in a
 * payload's `extensions` field, so the quantities in it arrive as `Value`s.
 * Call it when the provider's client package loads, after
 * {@link registerTypeUnits} has registered `typeName`.
 *
 * @param owner - The Topic id, such as `"isru.drills"`, or the type name of a
 * nested payload that carries the `extensions` field.
 * @param providerId - The provider id the payload's `extensions` entry is keyed by.
 * @param typeName - The provider's generated type name for that entry.
 *
 * @category Units and values
 */
export function registerProviderExtensionShape(
  owner: string,
  providerId: string,
  typeName: string,
): void {
  const forOwner = registeredExtensionShapes.get(owner) ?? new Map();
  forOwner.set(providerId, typeName);
  registeredExtensionShapes.set(owner, forOwner);
}

/**
 * The registered namespace -> generated type map for one payload, or `undefined`
 * when no provider has registered against it. Read by `wrapTopicPayload`'s walk.
 */
export function providerExtensionShapes(
  owner: string,
): ReadonlyMap<string, string> | undefined {
  return registeredExtensionShapes.get(owner);
}

/**
 * Returns the declared unit of every field of `topic`, keyed by field name.
 * Fields with no unit are left out, and a Topic with none returns an empty
 * object. For a Topic whose payload is an array, the fields are those of one
 * element.
 *
 * Includes Topics an Uplink registered with {@link registerTopicUnits}.
 *
 * @category Units and values
 */
export function unitsForTopic(topic: TopicId): UnitsByField {
  const generated = GENERATED_TOPIC_UNITS[topic];
  if (generated !== undefined) return generated;
  const registered = registeredTopicUnits.get(topic);
  if (registered !== undefined) return registered;
  const handDeclared = HAND_DECLARED_PAYLOAD_TYPES[topic];
  return handDeclared === undefined ? EMPTY : unitsForType(handDeclared);
}

/**
 * Returns the declared unit of one field of `topic`, or `undefined` when it
 * declares none. A field holding another payload declares no unit of its own.
 * `undefined` never means dimensionless: a dimensionless number declares
 * `"1"`, a fraction from 0 to 1 `"ratio"`, and a field with no unit at all
 * `"n/a"`.
 *
 * @category Units and values
 */
export function unitOf(topic: TopicId, field: string): SitrepUnit | undefined {
  return unitsForTopic(topic)[field];
}

/**
 * {@link unitsForTopic} for a payload type named by its generated type name,
 * such as `"ThermalHottestPart"`. Use it for a type that is only ever nested
 * inside a Topic's payload.
 *
 * @category Units and values
 */
export function unitsForType(typeName: string): UnitsByField {
  const generated = GENERATED_TYPE_UNITS[typeName];
  if (generated !== undefined) return generated;
  return registeredTypeUnits.get(typeName) ?? EMPTY;
}

/**
 * Returns which fields of `topic` hold another payload type, and its type
 * name. A name starting with `*` is a map of that type keyed by name, and one
 * ending in `[]` is a list of it.
 *
 * @category Units and values
 */
export function shapesForTopic(topic: TopicId): ShapesByField {
  const generated = GENERATED_TOPIC_SHAPES[topic];
  if (generated !== undefined) return generated;
  const registered = registeredTopicShapes.get(topic);
  if (registered !== undefined) return registered;
  const handDeclared = HAND_DECLARED_PAYLOAD_TYPES[topic];
  return handDeclared === undefined ? NO_SHAPES : shapesForType(handDeclared);
}

/**
 * {@link shapesForTopic} for a payload type named by its generated type name.
 *
 * @category Units and values
 */
export function shapesForType(typeName: string): ShapesByField {
  const generated = GENERATED_TYPE_SHAPES[typeName];
  if (generated !== undefined) return generated;
  return registeredTypeShapes.get(typeName) ?? NO_SHAPES;
}

/**
 * {@link unitOf} for a payload type named by its generated type name.
 *
 * @category Units and values
 */
export function unitOfTypeField(
  typeName: string,
  field: string,
): SitrepUnit | undefined {
  return unitsForType(typeName)[field];
}

/**
 * How each of `topic`'s `enum` fields reads as a word: the enum its ordinal
 * indexes (see {@link enumMembersOf}), or `null` for a field that already
 * carries the member's name. A field absent here is an enum the schema cannot
 * name.
 */
export function enumsForTopic(topic: TopicId): EnumsByField {
  const generated = GENERATED_TOPIC_ENUMS[topic];
  if (generated !== undefined) return generated;
  const registered = registeredTopicEnums.get(topic);
  if (registered !== undefined) return registered;
  const handDeclared = HAND_DECLARED_PAYLOAD_TYPES[topic];
  return handDeclared === undefined ? NO_ENUMS : enumsForType(handDeclared);
}

/** The same, keyed by generated interface name instead of Topic id. */
export function enumsForType(typeName: string): EnumsByField {
  return (
    GENERATED_TYPE_ENUMS[typeName] ??
    registeredTypeEnums.get(typeName) ??
    NO_ENUMS
  );
}

/** A contract enum's wire value to member name, or `undefined` for an enum the schema does not carry. */
export function enumMembersOf(
  enumName: string,
): Readonly<Record<number, string>> | undefined {
  return (
    GENERATED_ENUM_MEMBERS[enumName] ?? registeredEnumMembers.get(enumName)
  );
}

/**
 * Returns the fields of `topic` declared static: facts that do not change
 * over time, such as a kerbal's courage. Their values arrive marked
 * `Value.static`. Empty when the Topic declares none.
 *
 * @category Units and values
 */
export function staticsForTopic(topic: TopicId): readonly string[] {
  const generated = GENERATED_TOPIC_STATICS[topic];
  if (generated !== undefined) return generated;
  const registered = registeredTopicStatics.get(topic);
  if (registered !== undefined) return registered;
  const handDeclared = HAND_DECLARED_PAYLOAD_TYPES[topic];
  return handDeclared === undefined ? NO_STATICS : staticsForType(handDeclared);
}

const NO_GATES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Returns the fields of `typeName` that are exact at any instant while the
 * payload's own horizon field says its orbit is fully known, each mapped to
 * the name of that horizon field. Their values then arrive marked
 * `Value.deterministic`. Empty when the type declares none.
 *
 * @category Units and values
 */
export function deterministicWhileForType(
  typeName: string,
): Readonly<Record<string, string>> {
  return GENERATED_TYPE_DETERMINISTIC_WHILE[typeName] ?? NO_GATES;
}

/**
 * {@link staticsForTopic} for a payload type named by its generated type name.
 *
 * @category Units and values
 */
export function staticsForType(typeName: string): readonly string[] {
  const generated = GENERATED_TYPE_STATICS[typeName];
  if (generated !== undefined) return generated;
  return registeredTypeStatics.get(typeName) ?? NO_STATICS;
}
