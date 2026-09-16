import { PROVIDER_EXTENSIONS_FIELD } from "./extensions";
import type { TopicId } from "./topics";
import { hydrate, isValue, lookupUnit, value } from "./unit-system";
import {
  providerExtensionShapes,
  type ShapesByField,
  shapesForTopic,
  shapesForType,
  shapeTypeName,
  unitsForTopic,
  unitsForType,
} from "./units";

/**
 * Wraps a decoded payload's declared quantities into `Value`s.
 *
 * This is where a bare wire number becomes something that knows what it is.
 * The contract declares a unit per field, the codegen turns that into the
 * field's TYPE, and this is the runtime half: after it, `flight.altitude` is a
 * `Value<"m">` at runtime as well as in the type system, and `<Unit>` can
 * render it without anyone naming the unit again.
 *
 * ## Why it lives in the SDK
 *
 * Decoding a payload is the SDK's job. A headless consumer reading the stream
 * without the app's telemetry spine should get wrapped values too, and putting
 * this in `sitrep-client` would have meant the wrapping only happened for
 * consumers who also wanted React.
 *
 * ## Mutates in place, deliberately
 *
 * The input is the object `JSON.parse` just produced and nobody else holds a
 * reference to it. Copying would double the allocation on the hottest path in
 * the app for no observable difference. Pass a shared object and you will see
 * it change; do not.
 *
 * ## What is NOT wrapped
 *
 * A token the model has no unit for is a non-quantity: `text`, `flag`, `enum`,
 * `id`, `n/a`. That falls out of the registry lookup rather than needing a
 * list, because those tokens have no dimension and so were never units. A
 * vessel name has no magnitude to carry.
 *
 * ## It follows nested shapes
 *
 * A payload can hold another payload: `vessel.target.orbit` is a whole
 * `VesselOrbit`, `system.bodies.bodies[].orbit` an `OrbitEntry`. The unit maps
 * are flat per shape, so those nested units were unreachable from the parent
 * entry and eighty-five fields' worth of declared quantities arrived bare
 * while the contract typed them as `Value`. `GENERATED_TOPIC_SHAPES` says
 * which fields hold which shape, and this walks them.
 *
 * ## It follows provider extension bags too
 *
 * A payload carrying a `[ProviderExtensionBag]` field holds sub-trees core cannot
 * type, one per provider id. Their quantities are still `Value<unit>` in the
 * PROVIDER's own generated type, so the walk follows them the same way it follows
 * any nested shape, routed by `providerExtensionShapes` instead of by a generated
 * map. See `registerProviderExtensionShape` (units.ts) for why that routing needs
 * a registry of its own.
 */
/**
 * A payload type restated as the mod SENDS it: every `Value<U>` back down to
 * the plain number that actually crosses the wire, recursively, structure
 * otherwise untouched.
 *
 * It lives here rather than beside the test helper it was written for, because
 * it is the input type of the two functions below and a production module
 * cannot import from `testing/`. `testing/stub-transport` re-exports it, so
 * every existing import site is unchanged.
 *
 * `Value` is matched by its `magnitude`/`unit` pair rather than by name, so a
 * `Vec3Of<U>`'s three leaves collapse the same way its parent does.
 */
export type WireOf<T> = T extends {
  readonly magnitude: number;
  readonly unit: string;
}
  ? number
  : T extends readonly (infer E)[]
    ? WireOf<E>[]
    : T extends (...args: never[]) => unknown
      ? T
      : T extends object
        ? { [K in keyof T]: WireOf<T[K]> }
        : T;

export function wrapTopicPayload<P>(topic: TopicId, payload: WireOf<P>): P {
  return wrap(topic, unitsForTopic(topic), shapesForTopic(topic), payload) as P;
}

/**
 * The same, for a payload named by its generated interface rather than by a
 * Topic. Nested shapes (`ThermalHottestPart`) are reachable this way and no
 * Topic names them.
 */
export function wrapTypePayload<P>(typeName: string, payload: WireOf<P>): P {
  return wrap(
    typeName,
    unitsForType(typeName),
    shapesForType(typeName),
    payload,
  ) as P;
}

function wrap<T>(
  owner: string,
  units: Readonly<Record<string, string>>,
  shapes: ShapesByField,
  payload: T,
): T {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  // An array Topic's entry describes the ELEMENT's fields, which is what a
  // consumer indexes into.
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = wrap(owner, units, shapes, payload[i]);
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
      target[field] = wrapScalarOrList(target[field], unit);
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
      );
    }
  }
  return payload;
}

function wrapScalarOrList(current: unknown, unit: string): unknown {
  if (typeof current === "number") {
    return value(unit, current);
  }
  // A sequence of same-unit readings: a terrain profile is a list of distances
  // rather than one distance, so the unit belongs to each element.
  if (Array.isArray(current)) {
    return current.map((entry) =>
      typeof entry === "number" ? value(unit, entry) : entry,
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
  // Non-numeric entries then pass through untouched, so a map that is already
  // wrapped is left alone too and this stays idempotent like the cases above.
  if (current !== null && typeof current === "object" && !isValue(current)) {
    const entries = current as Record<string, unknown>;
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (typeof entry === "number") entries[key] = value(unit, entry);
    }
    return entries;
  }
  // Absent, null, or already wrapped. Leaving it alone keeps this idempotent,
  // which matters because a payload can be re-decoded on reconnect.
  return current;
}

/**
 * Gives every quantity in a payload its prototype back after a structured
 * clone.
 *
 * The mirror of {@link wrapTopicPayload}, for the hop the wrap cannot cover.
 * A `Value` is two fields plus a prototype, and only the two fields survive
 * PeerJS's serialisation, so a station screen receives `{magnitude, unit}`
 * objects that render perfectly and throw the moment anything calls a method
 * on one. `signalStrength.lessThanOrEqual is not a function`, inside a
 * component body, taking the whole dashboard down through the error boundary
 * on the screen that has no other way to see the mission.
 *
 * `hydrate` has always existed for this and its own doc names the PeerJS hop
 * by name. It was never called, which is the same failure as the wrap itself
 * being dead: a mechanism that is documented, exported, and not wired to
 * anything.
 *
 * Walks the payload rather than taking a field list, because there is no unit
 * map to consult here: the values arrive already SHAPED, and the only
 * question is whether each one has its prototype. `hydrate` is a pass-through
 * for anything that is not a value and for anything already hydrated, so the
 * walk is idempotent and safe on a payload of any shape.
 *
 * Mutates in place, same as the wrap and for the same reason: the object came
 * off the transport and nobody else holds it.
 */
/**
 * Takes every quantity in a payload back down to the bare number the wire
 * carries: the WRITE-side mirror of {@link wrapTopicPayload}.
 *
 * Command args travel the opposite way to telemetry, and until this existed
 * nothing carried them across the same boundary. The generated args types
 * declare quantities the same way a channel payload does
 * (`VantagePlanRequest.toUt: Value<"ut">`), so a typed caller builds a `Value`,
 * `JSON.stringify` reaches `Value.toJSON`, and `{"magnitude":80,"unit":"ut"}`
 * arrives at a host binding a `double`. That is not a field the mod ignores:
 * `ChannelEngine.BindCommandArgs` rejects an object bag for a numeric slot by
 * design, the throw fail-softs the whole handler, and the command answers
 * `null` having never run. The only reason no shipped widget hit it is that
 * every call site had already worked around it with a bare object literal or a
 * `WireOf<>` cast.
 *
 * ## Why it needs no unit map
 *
 * The wrap consults the generated field→unit map because a wire number says
 * nothing about what it is. Going the other way, the value already knows: a
 * `Value<"ut">` is the only thing assignable to a field declared `Value<"ut">`,
 * so its magnitude IS the declared unit's magnitude and there is nothing to
 * convert. That makes this a plain structural walk, like
 * {@link hydratePayload} and unlike the wrap.
 *
 * ## COPIES, where the other two mutate
 *
 * The wrap and the hydrate own what they are given: it came off the transport
 * and nobody else holds a reference. These args are the CALLER's object, very
 * often a widget's own state, and rewriting a `Value` in it to a number would
 * corrupt the state of whatever dispatched. So every container that contains a
 * quantity is rebuilt, and one that contains none is passed through untouched.
 */
export function dehydrateArgs<T>(args: T): WireOf<T>;
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

export function hydratePayload<T>(payload: T): T {
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
