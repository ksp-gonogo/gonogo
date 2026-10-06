import {
  PropagationHorizonKind,
  TrajectoryKind,
} from "./__generated__/contract";
import { PROVIDER_EXTENSIONS_FIELD } from "./extensions";
import type { TopicId } from "./topics";
import {
  asDeterministic,
  hydrate,
  isValue,
  lookupUnit,
  staticValue,
  value,
} from "./unit-system";
import {
  deterministicWhileForType,
  providerExtensionShapes,
  type ShapesByField,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  staticsForTopic,
  staticsForType,
  unitsForTopic,
  unitsForType,
} from "./units";

/*
 * The runtime half of the declared units: after the wrap a field typed `Value<"m">` is one at runtime too.
 * It mutates in place because the input is a freshly parsed frame nobody else holds, on the hottest path in the app.
 * It follows nested shapes and provider extension bags, which the flat per-shape unit maps cannot reach on their own.
 */
/**
 * A payload type as the mod sends it: every `Value` replaced by the plain
 * number that crosses the wire, at any depth, with the structure otherwise
 * the same. A `Vec3Of` becomes three numbers.
 *
 * @category Units and values
 */
export type WireOf<Shape> = Shape extends {
  readonly magnitude: number;
  readonly unit: string;
}
  ? number
  : Shape extends readonly (infer Element)[]
    ? WireOf<Element>[]
    : Shape extends (...args: never[]) => unknown
      ? Shape
      : Shape extends object
        ? { [Key in keyof Shape]: WireOf<Shape[Key]> }
        : Shape;

/**
 * Turns a payload as the mod sends it into the payload a reader sees: every
 * number whose field declares a unit becomes a `Value` in that unit, including
 * inside nested objects, lists and maps. Fields with no unit, such as names
 * and flags, are left as they are.
 *
 * Changes `payload` in place and returns it, so pass a payload nothing else
 * holds. Wrapping a payload twice changes nothing.
 *
 * @category Units and values
 */
export function wrapTopicPayload<Payload>(
  topic: TopicId,
  payload: WireOf<Payload>,
): Payload {
  return wrap(
    topic,
    unitsForTopic(topic),
    shapesForTopic(topic),
    staticsForTopic(topic),
    payload,
  ) as Payload;
}

/**
 * {@link wrapTopicPayload} for a payload named by its type, such as
 * `"ThermalHottestPart"`, rather than by a Topic. Use it for a type that is
 * only ever nested inside a Topic's payload.
 *
 * @category Units and values
 */
export function wrapTypePayload<Payload>(
  typeName: string,
  payload: WireOf<Payload>,
): Payload {
  return wrap(
    typeName,
    unitsForType(typeName),
    shapesForType(typeName),
    staticsForType(typeName),
    payload,
  ) as Payload;
}

function wrap<Payload>(
  owner: string,
  units: Readonly<Record<string, string>>,
  shapes: ShapesByField,
  statics: readonly string[],
  payload: Payload,
): Payload {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  // An array Topic's entry describes the ELEMENT's fields, which is what a consumer indexes into.
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = wrap(owner, units, shapes, statics, payload[i]);
    }
    return payload;
  }

  const target = payload as Record<string, unknown>;
  // Provider extension bags, before the generated shapes and units below: a
  // namespace is a whole payload of the PROVIDER's own type, and nothing in the
  // generated maps can name it. Only namespaces a provider has actually registered
  // are walked, so an unknown provider's sub-tree passes through untouched rather
  // than being guessed at.
  const extensionShapes = providerExtensionShapes(owner);
  if (extensionShapes !== undefined) {
    const bag = target[PROVIDER_EXTENSIONS_FIELD];
    if (bag !== null && typeof bag === "object") {
      const namespaces = bag as Record<string, unknown>;
      for (const [providerId, typeName] of extensionShapes) {
        if (!(providerId in namespaces)) continue;
        namespaces[providerId] = wrapTypePayload(
          typeName,
          namespaces[providerId],
        );
      }
    }
  }
  // Nested shapes first: a field can be both (a `Vec3` carries a unit AND is
  // an object), and the leaf propagation below owns that case, so recursing
  // first keeps the two from fighting over the same key.
  for (const [field, typeName] of Object.entries(shapes)) {
    if (!(field in target)) continue;
    // A leading `*` marks a MAP of the shape rather than one of it: the
    // values are the payloads, and treating the dictionary itself as one
    // would look for `amount` on the map and find nothing. `VesselPart
    // .resources` is keyed by resource name and is the case that forced it.
    if (typeName.startsWith("*")) {
      const entries = target[field];
      if (entries !== null && typeof entries === "object") {
        for (const key of Object.keys(entries as Record<string, unknown>)) {
          (entries as Record<string, unknown>)[key] = wrapTypePayload(
            typeName.slice(1),
            (entries as Record<string, unknown>)[key],
          );
        }
      }
      continue;
    }
    // A trailing `[]` marks a LIST of the shape. The element type is what the
    // wrap needs either way (`wrap` maps over an array it is handed), so the
    // marker is stripped and the recursion is unchanged: plurality matters to
    // a caller judging whether a PATH can be sampled, not to this walk.
    target[field] = wrapTypePayload(shapeTypeName(typeName), target[field]);
  }
  for (const [field, unit] of Object.entries(units)) {
    // A token with no unit in the model is a non-quantity. Nothing to wrap.
    if (lookupUnit(unit) === undefined) {
      continue;
    }
    const dot = field.indexOf(".");
    if (dot === -1) {
      // Only fields the payload actually HAS. Assigning unconditionally would
      // mint an own property holding `undefined` for every declared field the
      // frame omitted, which changes `Object.keys`, makes `"x" in payload`
      // true for something that never arrived, and puts nulls into a
      // re-serialised frame. A Topic sends a subset of its fields routinely.
      if (!(field in target)) continue;
      target[field] = wrapScalarOrList(
        target[field],
        unit,
        statics.includes(field),
      );
      continue;
    }
    // A Vec3 field's unit is declared on the parent and propagated onto dotted
    // leaf keys (position.x). The parent is an object whose leaves each carry
    // the unit, which is exactly what Vec3Of<U> says in the type system.
    const parent = target[field.slice(0, dot)];
    if (parent !== null && typeof parent === "object") {
      const leaf = field.slice(dot + 1);
      if (!(leaf in parent)) continue;
      (parent as Record<string, unknown>)[leaf] = wrapScalarOrList(
        (parent as Record<string, unknown>)[leaf],
        unit,
        statics.includes(field),
      );
    }
  }
  /*
   * Last, over what the passes above wrapped: a field the contract declares
   * deterministic while a sibling horizon says so takes the stamp on every
   * quantity under it, or on none.
   */
  for (const [field, gate] of Object.entries(
    deterministicWhileForType(owner),
  )) {
    if (!(field in target)) continue;
    if (!horizonIsExact(target[gate])) continue;
    target[field] = stampDeterministic(target[field]);
  }
  return payload;
}

/**
 * Whether a decoded `PropagationHorizon` says its elements are the whole
 * truth: Unbounded and Analytic. A payload with no horizon at all is a host
 * older than the field, which has no seam for a provider to bound a body
 * through, so it is a stock install and reads as exact. `Unspecified` is a
 * producer that has the field and could not fill it, and does not.
 */
function horizonIsExact(horizon: unknown): boolean {
  if (horizon === undefined || horizon === null) return true;
  if (typeof horizon !== "object") return false;
  const { kind, trajectoryKind } = horizon as {
    kind?: unknown;
    trajectoryKind?: unknown;
  };
  return (
    kind === PropagationHorizonKind.Unbounded &&
    trajectoryKind === TrajectoryKind.Analytic
  );
}

/** Every quantity under `node` restamped deterministic; structure otherwise untouched, and a static value left static. */
function stampDeterministic(node: unknown): unknown {
  if (isValue(node)) {
    return node.static === true ? node : asDeterministic(node);
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = stampDeterministic(node[i]);
    return node;
  }
  if (node !== null && typeof node === "object") {
    const entries = node as Record<string, unknown>;
    for (const key of Object.keys(entries)) {
      entries[key] = stampDeterministic(entries[key]);
    }
  }
  return node;
}

function wrapScalarOrList(
  current: unknown,
  unit: string,
  isStatic: boolean,
): unknown {
  const mint = isStatic ? staticValue : value;
  if (typeof current === "number") {
    return mint(unit, current);
  }
  // A sequence of same-unit readings: a terrain profile is a list of distances rather than one distance, so the unit belongs to each element.
  if (Array.isArray(current)) {
    return current.map((entry) =>
      typeof entry === "number" ? mint(unit, entry) : entry,
    );
  }
  // A name-keyed MAP of same-unit readings (a rate per resource name). Same
  // rule as the list: the unit belongs to each VALUE, and the key is just a
  // name. The `*` branch above already covers a map whose values are nested
  // SHAPES; this is the map whose values are bare scalars, which had no case
  // until `kerbalism.lifesupport.rates` needed one. Every earlier name-keyed
  // channel used a shape as its value (`vessel.resources` -> ResourceAmount),
  // and a shape's own properties carry the units.
  //
  // Guarded by `!isValue`, because a Value IS an object: without the guard
  // this branch would walk an already-wrapped scalar and re-wrap its own
  // `magnitude` field, turning `{magnitude: 1200, unit: "K"}` into
  // `{magnitude: Value(1200), unit: "K"}` on the second decode. The existing
  // idempotence test caught exactly that.
  //
  // Non-numeric entries then pass through untouched, so a map that is already wrapped is left alone too and this stays idempotent like the cases above.
  if (current !== null && typeof current === "object" && !isValue(current)) {
    const entries = current as Record<string, unknown>;
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (typeof entry === "number") entries[key] = mint(unit, entry);
    }
    return entries;
  }
  // Absent, null, or already wrapped. Leaving it alone keeps this idempotent,
  // which matters because a payload can be re-decoded on reconnect.
  return current;
}

/**
 * Returns command arguments as the mod expects them: every `Value` replaced by
 * its number, at any depth. The mod refuses an argument sent as a `Value`
 * object where it expects a number.
 *
 * It copies rather than changing `args`, since they are often a widget's own
 * state. Objects and arrays holding no `Value` are returned as they are.
 *
 * @category Units and values
 */
export function dehydrateArgs<Args>(args: Args): WireOf<Args>;
/* The implementation walks an untyped tree, so it cannot state the conditional
   type the overload above promises. Declared as two signatures rather than
   asserted at the `return`, because an assertion out of `unknown` is what the
   unknown-cast scan exists to stop and the overload says the same thing without
   one. */
export function dehydrateArgs(args: unknown): unknown {
  return dehydrate(args);
}

function dehydrate(args: unknown): unknown {
  if (args === null || typeof args !== "object") return args;
  /* A Value is the whole point of the walk, and it is checked before the array
     and object arms because it is both: an object whose own keys would
     otherwise be copied across as `magnitude` and `unit`. */
  if (isValue(args)) return args.toWire();
  if (Array.isArray(args)) {
    const wire = args.map(dehydrate);
    return wire.some((entry, i) => entry !== args[i]) ? wire : args;
  }
  const source = args as Record<string, unknown>;
  let wire: Record<string, unknown> | undefined;
  for (const key of Object.keys(source)) {
    const converted = dehydrate(source[key]);
    if (converted === source[key]) continue;
    /* First change decides there is one, so a payload of plain numbers (which
       is nearly every command) is handed straight back. */
    wire ??= { ...source };
    wire[key] = converted;
  }
  return wire ?? args;
}

/**
 * Restores every `Value` in a payload that lost its methods crossing JSON or a
 * structured clone, such as on the way to a station screen. Changes `payload`
 * in place and returns it; anything that is not a `Value` is left as it is,
 * and restoring a payload twice changes nothing.
 *
 * @category Units and values
 */
export function hydratePayload<Payload>(payload: Payload): Payload {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  if (isValue(payload)) {
    return hydrate(payload);
  }
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = hydratePayload(payload[i]);
    }
    return payload;
  }
  const target = payload as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    target[key] = hydratePayload(target[key]);
  }
  return payload;
}
