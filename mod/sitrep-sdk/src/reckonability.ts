// Runtime accessor for the contracts' reckonability declarations.
//
// Reckonability is declared PER VALUE, in C# ([SitrepReckonable] on a payload's
// property, or [assembly: SitrepReckonableOn] for another owner's Topic). Each
// contract's codegen writes its rows into the value-tag table its client
// registers (./contract-tags.ts), so core's rows and an Uplink's are read the
// same way, each carrying the owner that declared it.
//
// Two views, because two layers ask different questions. The TYPE layer wants
// the field names, so `ReckonableReading<Payload, ReckonableKey>` can project the payload down to
// the fields a model moves; codegen emits the names rather than the `Pick<>`
// because `K extends keyof T` is then a compile-time cross-check that a
// generated field name still exists on the generated payload. The RUNTIME layer
// wants the declared inputs, so a store that cannot run the model can say which
// published input was missing, spelled the way the contract spells it.

import type {
  GENERATED_RECKONABLE_FIELDS,
  GeneratedReckonableInput,
  GeneratedReckonableValue,
} from "./__generated__/reckonability";
import { type OwnedReckonableValue, reckonableRowsOf } from "./contract-tags";
import type { TopicId } from "./topics";

export type {
  GeneratedReckonableInput,
  GeneratedReckonableValue,
  OwnedReckonableValue,
};

type GeneratedReckonableFieldMap = {
  readonly [Topic in keyof typeof GENERATED_RECKONABLE_FIELDS]: (typeof GENERATED_RECKONABLE_FIELDS)[Topic][number];
};

/**
 * The fields of each object Topic a declared model moves, as a union per
 * Topic. Core's come from its contract; an Uplink whose contract marks a value
 * of its own object Topic adds that Topic here with `declare module
 * "@ksp-gonogo/sitrep-sdk"`, the same way it adds to `TopicPayloadMap`, so
 * reading it returns a {@link ReckonableReading}.
 *
 * @category Reckoners
 */
export interface ReckonableFieldMap extends GeneratedReckonableFieldMap {}

/**
 * A Topic whose contract declares a forward model on at least one of its
 * top-level values, such as `vessel.flight`. Reading one with
 * {@link useTelemetry} returns a {@link ReckonableReading}.
 *
 * @category Reckoners
 */
export type ReckonableTopic = keyof ReckonableFieldMap;

/**
 * The fields of `Topic` that have a declared forward model, as a union of
 * field names, or `never` for a Topic with none.
 *
 * @category Reckoners
 */
export type ReckonableFields<Topic extends TopicId> =
  Topic extends ReckonableTopic ? ReckonableFieldMap[Topic] : never;

/**
 * Returns whether any registered contract declares a forward model on a value
 * of `topic`: core's own, or an Uplink's on a Topic it publishes or models.
 *
 * @category Reckoners
 * @categoryDescription Reckoners
 * The forward models that carry a value between observations: which Topics and
 * fields can be reckoned, the inputs each model needs, and the Kepler and
 * atmospheric reckoners that work out a value for now from the last one
 * received.
 */
export function isReckonableTopic(topic: string): topic is ReckonableTopic {
  return reckonableRowsOf(topic).length > 0;
}

/**
 * Returns every declared model on `topic`, one entry per field and model, or
 * an empty array for a Topic with none. A field with two models appears twice,
 * each with its own basis and inputs: `vessel.flight`'s `altitudeAsl` uses an
 * orbit model above the atmosphere and a rate model below it.
 *
 * Pass `owner` for only the models that owner's contract declared, which is
 * the set its registered reckoner answers for.
 *
 * @category Reckoners
 */
export function reckonableValuesOf(
  topic: string,
  owner?: string,
): readonly OwnedReckonableValue[] {
  return reckonableRowsOf(topic, owner);
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
