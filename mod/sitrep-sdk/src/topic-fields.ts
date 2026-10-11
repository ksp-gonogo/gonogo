import {
  type EnumsByField,
  enumMembersOf,
  enumsForTopic,
  enumsForType,
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
 * What kind of value a field holds, worked out from its declared unit.
 *
 * - `quantity`: a measured or counted number, including dimensionless ones
 * - `flag`: a true or false
 * - `text`: a string
 * - `enum`: one of a fixed set of members; see {@link EnumEncoding}
 * - `collection`: an array, or a map keyed by an id such as a vessel id. Its
 *   path is a field, but the entries inside it are not listed
 *
 * Only a `quantity` can be compared against a threshold.
 *
 * @category Reading telemetry
 */
export type TopicFieldKind =
  | "quantity"
  | "flag"
  | "text"
  | "enum"
  | "collection";

/**
 * How an `enum` field's value reads as a word: by looking its ordinal up in
 * `names`, or as it is when the payload already carries the member's name.
 *
 * @category Reading telemetry
 */
export type EnumEncoding =
  | {
      /** The enum is carried as its ordinal. */
      by: "ordinal";
      /** The member name of each ordinal. */
      names: Readonly<Record<number, string>>;
    }
  | {
      /** The enum is carried as its member name. */
      by: "name";
    };

/**
 * One field of a Topic, as {@link enumerateTopicFields} lists it.
 *
 * @category Reading telemetry
 */
export interface TopicField {
  /** Dotted path relative to the Topic root, e.g. `"balances.funds"`. */
  path: string;
  /** The declared unit token. Absent on a `collection`, which has no unit. */
  unit?: SitrepUnit;
  /** What shape the field has: a quantity, an enum, a collection and so on. */
  kind: TopicFieldKind;
  /** How an `enum` field reads as a word. Absent when the contract gives its members no names. */
  enumEncoding?: EnumEncoding;
}

function enumEncodingOf(
  enums: EnumsByField,
  field: string,
): EnumEncoding | undefined {
  const enumName = enums[field];
  if (enumName === undefined) return undefined;
  if (enumName === null) return { by: "name" };
  const names = enumMembersOf(enumName);
  return names === undefined ? undefined : { by: "ordinal", names };
}

/**
 * The contract tokens that annotate a field carrying no dimension. `id` maps to
 * `text` because a reader gets a string back either way; the separate token only
 * records that the string names something.
 *
 * A token absent from here is treated as a quantity, which is the right default
 * for an open vocabulary: an Uplink registers units of its own, and a token this
 * map has never heard of is far more likely to be one of those than a new kind
 * of non-quantity.
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
  enums: EnumsByField,
  prefix: string,
  seenTypes: ReadonlySet<string>,
  depth: number,
  out: TopicField[],
): void {
  if (depth > MAX_DEPTH) return;

  for (const field of Object.keys(units).sort()) {
    const unit = units[field];
    const kind = kindOfUnit(unit);
    const enumEncoding =
      kind === "enum" ? enumEncodingOf(enums, field) : undefined;
    out.push({
      path: prefix + field,
      unit,
      kind,
      ...(enumEncoding === undefined ? {} : { enumEncoding }),
    });
  }

  for (const field of Object.keys(shapes).sort()) {
    // A unit already claimed this field as a leaf, so the shape entry is the nested-type half of a field the walk has recorded.
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
      enumsForType(nested),
      `${prefix + field}.`,
      new Set([...seenTypes, nested]),
      depth + 1,
      out,
    );
  }
}

/**
 * Returns every field declared under `topic`, as paths dotted from the Topic
 * root and sorted by path. Nested types are listed field by field, and a
 * `collection` field is listed but not entered.
 *
 * Includes the fields of Topics an Uplink has registered. A Topic with no
 * declared units or shapes returns an empty array, which means the Topic is
 * not described rather than that it has no fields.
 *
 * @category Reading telemetry
 */
export function enumerateTopicFields(topic: string): TopicField[] {
  const units = unitsForTopic(topic as never);
  const shapes = shapesForTopic(topic as never);
  if (Object.keys(units).length === 0 && Object.keys(shapes).length === 0) {
    return [];
  }
  const out: TopicField[] = [];
  walk(units, shapes, enumsForTopic(topic as never), "", new Set(), 0, out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
