import { UNIT_DEFINITIONS } from "./unit-system/definitions";
import {
  isPluralShape,
  type ShapesByField,
  type SitrepUnit,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  type UnitsByField,
  unitsForTopic,
  unitsForType,
} from "./units";

/**
 * What a reader actually gets back from a field, derived from its declared
 * unit token rather than guessed from the field's name.
 *
 * `quantity` is anything the unit system dimensions, `count` and the
 * dimensionless `1` included. The other four are the contract's non-quantity
 * tokens: they annotate a field that carries no dimension, so a threshold
 * comparison cannot use them.
 *
 * `collection` is an array or a dynamic-key map. The path as far as the
 * collection is a real field; what sits inside it is keyed by something the
 * contract never names (a facility id, a vessel id), so enumeration stops
 * there rather than guessing.
 */
export type TopicFieldKind =
  | "quantity"
  | "flag"
  | "text"
  | "enum"
  | "collection";

/** One enumerated field of one Topic, as a picker offers it. */
export interface TopicField {
  /** Dotted path relative to the Topic root, e.g. `"economy.funds"`. */
  path: string;
  /** The declared unit token. Absent on a `collection`, which has no unit. */
  unit?: SitrepUnit;
  kind: TopicFieldKind;
}

/**
 * The four contract tokens that annotate a field carrying no dimension.
 * A token absent from `UNIT_DEFINITIONS` and from this map is still a
 * quantity: `UNIT_DEFINITIONS` is the model's own list and an Uplink may
 * register a token of its own that the model has not been taught yet.
 */
const NON_QUANTITY_KINDS: Readonly<Record<string, TopicFieldKind>> =
  Object.freeze({
    flag: "flag",
    text: "text",
    id: "text",
    enum: "enum",
  });

/**
 * `n/a` annotates the components of the shared three-component vector shape,
 * which carry the unit of whichever field holds the vector rather than one of
 * their own. A use site is reached through the dotted leaves the units map
 * already carries for it (`relativePosition.x: "m"`), so the only paths that
 * land here are generic ones, and they are numeric.
 */
function kindOfUnit(unit: SitrepUnit): TopicFieldKind {
  if (unit === "n/a") return "quantity";
  return NON_QUANTITY_KINDS[unit] ?? "quantity";
}

/**
 * Depth backstop for a contract type graph that references itself. The cycle
 * guard below already refuses to re-enter a type on the same path, so this
 * only bounds a graph that nests distinct types very deeply.
 */
const MAX_DEPTH = 8;

function walk(
  units: UnitsByField,
  shapes: ShapesByField,
  prefix: string,
  seenTypes: ReadonlySet<string>,
  depth: number,
  out: TopicField[],
): void {
  if (depth > MAX_DEPTH) return;

  for (const field of Object.keys(units).sort()) {
    const unit = units[field];
    out.push({
      path: prefix + field,
      unit,
      kind: kindOfUnit(unit),
    });
  }

  for (const field of Object.keys(shapes).sort()) {
    // A unit already claimed this field as a leaf, so the shape entry is the
    // nested-type half of a field the walk has recorded.
    if (units[field] !== undefined) continue;

    const shape = shapes[field];
    if (isPluralShape(shape)) {
      out.push({ path: prefix + field, kind: "collection" });
      continue;
    }
    const nested = shapeTypeName(shape);
    if (seenTypes.has(nested)) continue;

    const nestedUnits = unitsForType(nested);
    const nestedShapes = shapesForType(nested);
    if (
      Object.keys(nestedUnits).length === 0 &&
      Object.keys(nestedShapes).length === 0
    ) {
      continue;
    }
    walk(
      nestedUnits,
      nestedShapes,
      `${prefix + field}.`,
      new Set([...seenTypes, nested]),
      depth + 1,
      out,
    );
  }
}

/**
 * Every field the contract declares under `topic`, as dotted paths relative to
 * the Topic root, sorted by path.
 *
 * Reads the same two halves of the contract's generated metadata that judging a
 * single path reads, in enumeration order rather than one path at a time: a
 * field with a declared UNIT is a leaf, a field declared as a nested contract
 * TYPE is descended into, and a plural field ends the walk. Goes through
 * `unitsForTopic`/`shapesForTopic` rather than the generated maps directly, so a
 * Topic an Uplink registered at module load enumerates alongside a first-party
 * one.
 *
 * A Topic with no declared metadata returns an empty array. That is not the
 * same as a Topic with no fields: it means nothing has annotated it, and a
 * caller building a picker from this should treat an empty result as an
 * absence to surface rather than a Topic with nothing to offer.
 */
export function enumerateTopicFields(topic: string): TopicField[] {
  const units = unitsForTopic(topic as never);
  const shapes = shapesForTopic(topic as never);
  if (Object.keys(units).length === 0 && Object.keys(shapes).length === 0) {
    return [];
  }
  const out: TopicField[] = [];
  walk(units, shapes, "", new Set(), 0, out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
