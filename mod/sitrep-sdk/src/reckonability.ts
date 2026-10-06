// Runtime accessor for the contract's reckonability declarations.
//
// Reckonability is declared PER VALUE, in C# ([SitrepReckonable] on a Topic
// payload's property), and codegen emits the rows into
// ./__generated__/reckonability.ts. This module is the hand-written accessor
// over that data, mirroring units.ts and control-channels.ts: the generated file
// stays free to change shape, and every consumer holds a named function instead
// of an import of the const.
//
// Two views, because two layers ask different questions. The TYPE layer wants
// the field names, so `ReckonableReading<Payload, ReckonableKey>` can project the payload down to
// the fields a model moves; codegen emits the names rather than the `Pick<>`
// because `K extends keyof T` is then a compile-time cross-check that a
// generated field name still exists on the generated payload. The RUNTIME layer
// wants the declared inputs, so a store that cannot run the model can say which
// published input was missing, spelled the way the contract spells it.

import {
  GENERATED_RECKONABLE_FIELDS,
  GENERATED_RECKONABLE_VALUES,
  type GeneratedReckonableInput,
  type GeneratedReckonableValue,
} from "./__generated__/reckonability";
import type { TopicId } from "./topics";

export type { GeneratedReckonableInput, GeneratedReckonableValue };

/**
 * A Topic whose contract declares a forward model on at least one of its
 * values, such as `vessel.flight`. Reading one with {@link useTelemetry}
 * returns a {@link ReckonableReading}.
 *
 * @category Reckoners
 */
export type ReckonableTopic = keyof typeof GENERATED_RECKONABLE_FIELDS;

/**
 * The fields of `Topic` that have a declared forward model, as a union of
 * field names, or `never` for a Topic with none.
 *
 * @category Reckoners
 */
export type ReckonableFields<Topic extends TopicId> =
  Topic extends ReckonableTopic
    ? (typeof GENERATED_RECKONABLE_FIELDS)[Topic][number]
    : never;

/**
 * Returns whether `topic` has a declared forward model on any of its values.
 *
 * @category Reckoners
 */
export function isReckonableTopic(topic: string): topic is ReckonableTopic {
  return topic in GENERATED_RECKONABLE_FIELDS;
}

const BY_TOPIC: ReadonlyMap<string, readonly GeneratedReckonableValue[]> =
  GENERATED_RECKONABLE_VALUES.reduce((map, row) => {
    map.set(row.topic, [...(map.get(row.topic) ?? []), row]);
    return map;
  }, new Map<string, GeneratedReckonableValue[]>());

/**
 * Returns every declared model on `topic`, one entry per field and model, or
 * an empty array for a Topic with none. A field with two models appears twice,
 * each with its own basis and inputs: `vessel.flight`'s `altitudeAsl` uses an
 * orbit model above the atmosphere and a rate model below it.
 *
 * @category Reckoners
 */
export function reckonableValuesOf(
  topic: string,
): readonly GeneratedReckonableValue[] {
  return BY_TOPIC.get(topic) ?? [];
}

/**
 * Returns every input any declared model of one field needs, without
 * repeats, or `undefined` when the field has no declared model. Subscribe to
 * all of them to be able to carry the field forward. For which inputs each
 * model needs, read {@link reckonableValuesOf}.
 *
 * @category Reckoners
 */
export function reckonableInputsOf(
  topic: string,
  field: string,
): readonly GeneratedReckonableInput[] | undefined {
  const rows = reckonableValuesOf(topic).filter((row) => row.field === field);
  if (rows.length === 0) return undefined;
  const seen = new Set<string>();
  const inputs: GeneratedReckonableInput[] = [];
  for (const input of rows.flatMap((row) => row.inputs)) {
    const key = reckonableInputSpelling(input);
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push(input);
  }
  return inputs;
}

/**
 * Returns a declared input written as the contract writes it, which is also
 * how a decline names it: `relativeVelocity` for a field of the same Topic,
 * `@system.bodies` for another Topic, `@vessel.orbit#mu` for a field of
 * another Topic.
 *
 * @category Reckoners
 */
export function reckonableInputSpelling(
  input: GeneratedReckonableInput,
): string {
  if (input.topic === "") return input.path;
  return input.path === ""
    ? `@${input.topic}`
    : `@${input.topic}#${input.path}`;
}
