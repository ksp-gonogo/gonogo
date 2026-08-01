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
// ── Coverage is partial, deliberately ───────────────────────────────────────────────
// Annotation is being filled in field by field, and an unannotated field returns
// `undefined` rather than a guess. `undefined` means "no declared unit yet", NOT
// "dimensionless": a genuinely dimensionless quantity (Mach, eccentricity) carries the
// explicit `"1"` token, and a 0..1 fraction carries `"ratio"`. A formatter must treat
// those three cases differently, which is exactly why they are three distinct values.

import type { SitrepUnit, UnitsByField } from "./__generated__/units";
import {
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
import type { TopicId } from "./topics";

export type { SitrepUnit, UnitsByField };

const EMPTY: UnitsByField = Object.freeze({});

/**
 * Every field on `topic` that has a declared unit. Fields with no annotation are
 * absent from the returned object; a Topic with no annotated fields at all returns an
 * empty object rather than `undefined`, so a caller can index it unconditionally.
 *
 * For an array Topic the entry describes the ELEMENT's fields, which is what a consumer
 * indexes into.
 */
export function unitsForTopic(topic: TopicId): UnitsByField {
  return GENERATED_TOPIC_UNITS[topic] ?? EMPTY;
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
  return GENERATED_TYPE_UNITS[typeName] ?? EMPTY;
}

/** As {@link unitOf}, but keyed by generated interface name instead of Topic id. */
export function unitOfTypeField(
  typeName: string,
  field: string,
): SitrepUnit | undefined {
  return unitsForType(typeName)[field];
}
