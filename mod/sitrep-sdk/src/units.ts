// Runtime unit lookup for wire-payload fields.
//
// ── The hole this closes ────────────────────────────────────────────────────────────
// The app displays units everywhere and, before this, none of them came from the data.
// `Sitrep.Contract` stated units only as English prose inside `<summary>` doc comments
// (and for most fields, not even that), so nothing machine-readable ever reached the
// client: the generated SDK carried no unit metadata at all. Every widget therefore
// hand-rolled its own literal, including whole duplicated scaling ladders, and the only
// machine-readable unit table in the repo (`packages/data/src/schema/telemachusMeta.ts`)
// is keyed by LEGACY Telemachus keys (`v.altitude`) that the live topic path no longer
// speaks.
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
  KnownSitrepUnit,
  ShapesByField,
  SitrepUnit,
  UnitsByField,
} from "./__generated__/units";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
import type { TopicId } from "./topics";

export type { KnownSitrepUnit, ShapesByField, SitrepUnit, UnitsByField };

const EMPTY: UnitsByField = Object.freeze({});
const NO_SHAPES: ShapesByField = Object.freeze({});

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
 * payload types (uplink-types-out-of-core plan). `GENERATED_TOPIC_UNITS`/
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

/**
 * Self-register a relocated Uplink Topic's unit (and optional nested-shape)
 * map. Called at module load by the owning Uplink's client package. Last
 * write wins for a given topic; a double import of the same Uplink client
 * registers the same data twice, harmlessly.
 */
export function registerTopicUnits(
  topic: string,
  units: UnitsByField,
  shapes: ShapesByField = NO_SHAPES,
): void {
  registeredTopicUnits.set(topic, units);
  registeredTopicShapes.set(topic, shapes);
}

/**
 * The TYPE-keyed half of the same registry, and it is not optional the moment a
 * relocated payload has any nesting.
 *
 * `registerTopicUnits` above covers a Topic's OWN fields, which was the whole
 * problem while every relocated type was flat, which the plan's first three
 * steps all were. It is not sufficient for a nested
 * one: `wrapTopicPayload` reads `shapesForTopic` to learn that a field holds
 * another shape, then recurses through `wrapTypePayload`, which resolves that
 * shape BY NAME through `unitsForType`/`shapesForType`. Those read the
 * type-keyed generated maps, so a relocated nested type is unreachable from the
 * topic registration alone and its quantities arrive bare while the generated
 * TYPE still says `Value<"m">`.
 *
 * `scansat.scanningVessels` is the case that forced it (the fourth relocation,
 * the first with nesting): its `sensors` field holds `ScanSensorEntry[]`, whose
 * `minAlt`/`maxAlt`/`bestAlt`/`fov` are the deepest declared quantities on the
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

/**
 * Self-register a relocated Uplink payload TYPE's unit (and optional
 * nested-shape) map, keyed by its generated interface name. Called at module
 * load by the owning Uplink's client package, normally by looping over its own
 * generated `GENERATED_TYPE_UNITS`/`GENERATED_TYPE_SHAPES`, so a type added to
 * that Uplink's contract later needs no new call site.
 */
export function registerTypeUnits(
  typeName: string,
  units: UnitsByField,
  shapes: ShapesByField = NO_SHAPES,
): void {
  registeredTypeUnits.set(typeName, units);
  registeredTypeShapes.set(typeName, shapes);
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
 *     `reliability.summary` (a core-generated Topic) is silently ignored. Were the
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
 * GENERAL, not reliability-specific: `owner` is any Topic or type carrying a
 * `[ProviderExtensionBag]` property, so the science-subsume step registers its own
 * namespaces the same way with no further core change.
 */
const registeredExtensionShapes = new Map<string, Map<string, string>>();

/**
 * Self-register the generated type held by one provider's namespace of one
 * payload's extension bag. Called at module load by the provider's own client
 * package, alongside its `registerTypeUnits` loop (that loop is what makes the
 * named type resolvable; this is what points the bag at it).
 *
 * @param owner Topic id (`"reliability.summary"`) or generated type name.
 * @param providerId The Kernel provider id keying the namespace, the same string
 *   the provider registers with the Kernel and tags its payloads with.
 * @param typeName The provider's own generated interface name for that namespace.
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
 * Every field on `topic` that has a declared unit. Fields with no annotation are
 * absent from the returned object; a Topic with no annotated fields at all returns an
 * empty object rather than `undefined`, so a caller can index it unconditionally.
 *
 * For an array Topic the entry describes the ELEMENT's fields, which is what a consumer
 * indexes into.
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
 * The declared unit of one field on one Topic, or `undefined` when that field has no
 * annotation yet. See this module's header for why `undefined` is not the same as
 * dimensionless.
 */
export function unitOf(topic: TopicId, field: string): SitrepUnit | undefined {
  return unitsForTopic(topic)[field];
}

/**
 * The type-keyed view, for NESTED payload shapes that no Topic names directly (e.g.
 * `ThermalHottestPart`, which hangs off `vessel.thermal` rather than being a Topic of
 * its own). `typeName` is the generated interface name in `./__generated__/contract`.
 */
export function unitsForType(typeName: string): UnitsByField {
  const generated = GENERATED_TYPE_UNITS[typeName];
  if (generated !== undefined) return generated;
  return registeredTypeUnits.get(typeName) ?? EMPTY;
}

/**
 * Which of `topic`'s fields hold ANOTHER payload shape, and which one.
 *
 * The unit maps are flat, so a nested shape's declared units are unreachable
 * from the parent's entry; this is what lets the runtime wrap follow the field
 * down. See `GENERATED_TOPIC_SHAPES`' own doc for the case that forced it.
 */
export function shapesForTopic(topic: TopicId): ShapesByField {
  const generated = GENERATED_TOPIC_SHAPES[topic];
  if (generated !== undefined) return generated;
  const registered = registeredTopicShapes.get(topic);
  if (registered !== undefined) return registered;
  const handDeclared = HAND_DECLARED_PAYLOAD_TYPES[topic];
  return handDeclared === undefined ? NO_SHAPES : shapesForType(handDeclared);
}

/** The same, keyed by generated interface name instead of Topic id. */
export function shapesForType(typeName: string): ShapesByField {
  const generated = GENERATED_TYPE_SHAPES[typeName];
  if (generated !== undefined) return generated;
  return registeredTypeShapes.get(typeName) ?? NO_SHAPES;
}

/** As {@link unitOf}, but keyed by generated interface name instead of Topic id. */
export function unitOfTypeField(
  typeName: string,
  field: string,
): SitrepUnit | undefined {
  return unitsForType(typeName)[field];
}
