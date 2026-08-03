import type { TopicId } from "./topics";
import { lookupUnit, value } from "./unit-system";
import { unitsForTopic, unitsForType } from "./units";

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
 */
export function wrapTopicPayload<T>(topic: TopicId, payload: T): T {
  return wrap(unitsForTopic(topic), payload);
}

/**
 * The same, for a payload named by its generated interface rather than by a
 * Topic. Nested shapes (`ThermalHottestPart`) are reachable this way and no
 * Topic names them.
 */
export function wrapTypePayload<T>(typeName: string, payload: T): T {
  return wrap(unitsForType(typeName), payload);
}

function wrap<T>(units: Readonly<Record<string, string>>, payload: T): T {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  // An array Topic's entry describes the ELEMENT's fields, which is what a
  // consumer indexes into.
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = wrap(units, payload[i]);
    }
    return payload;
  }

  const target = payload as Record<string, unknown>;
  for (const [field, unit] of Object.entries(units)) {
    // A token with no unit in the model is a non-quantity. Nothing to wrap.
    if (lookupUnit(unit) === undefined) {
      continue;
    }
    const dot = field.indexOf(".");
    if (dot === -1) {
      target[field] = wrapScalarOrList(target[field], unit);
      continue;
    }
    // A Vec3 field's unit is declared on the parent and propagated onto dotted
    // leaf keys (position.x). The parent is an object whose leaves each carry
    // the unit, which is exactly what Vec3Of<U> says in the type system.
    const parent = target[field.slice(0, dot)];
    if (parent !== null && typeof parent === "object") {
      const leaf = field.slice(dot + 1);
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
  // Absent, null, or already wrapped. Leaving it alone keeps this idempotent,
  // which matters because a payload can be re-decoded on reconnect.
  return current;
}
