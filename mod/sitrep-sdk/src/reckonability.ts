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
// the field names, so `ReckonableReading<T, K>` can project the payload down to
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
  type GeneratedReckoningBasis,
} from "./__generated__/reckonability";
import type { TopicId } from "./topics";

export type {
  GeneratedReckonableInput,
  GeneratedReckonableValue,
  GeneratedReckoningBasis,
};

/**
 * A Topic the contract declares at least one reckonable value on.
 *
 * The set is small and it is meant to be: a mark is a promise that the wire
 * carries a model's inputs, so the majority of Topics are correctly absent.
 */
export type ReckonableTopic = keyof typeof GENERATED_RECKONABLE_FIELDS;

/**
 * The declared field names for one Topic, as a key union, or `never` for a Topic
 * with no marks.
 *
 * `never` rather than an error because this is applied inside a conditional
 * type: `useTelemetry` asks it of every `TopicId` and only reaches
 * `ReckonableReading` for the ones that answer.
 */
export type ReckonableFields<T extends TopicId> = T extends ReckonableTopic
  ? (typeof GENERATED_RECKONABLE_FIELDS)[T][number]
  : never;

/** Whether the contract declares any value on `topic` reckonable. */
export function isReckonableTopic(topic: string): topic is ReckonableTopic {
  return topic in GENERATED_RECKONABLE_FIELDS;
}

const BY_TOPIC: ReadonlyMap<string, readonly GeneratedReckonableValue[]> =
  GENERATED_RECKONABLE_VALUES.reduce((map, row) => {
    map.set(row.topic, [...(map.get(row.topic) ?? []), row]);
    return map;
  }, new Map<string, GeneratedReckonableValue[]>());

/**
 * Every value the contract declares reckonable on `topic`, in the generated
 * order (ordinal by field), or an empty array for an undeclared Topic.
 *
 * Empty rather than `undefined` so a caller iterating never has to branch first:
 * "no declared model" and "a declared model for none of these fields" are the
 * same statement to anyone reading the rows.
 */
export function reckonableValuesOf(
  topic: string,
): readonly GeneratedReckonableValue[] {
  return BY_TOPIC.get(topic) ?? [];
}

/**
 * The declared inputs for one marked value, or `undefined` when that value
 * carries no mark.
 *
 * `undefined` here, unlike {@link reckonableValuesOf}'s empty array, because a
 * mark's input list is NEVER empty (the gate rejects one that is), so an empty
 * answer could only mean the value is unmarked and saying so with a different
 * shape costs nothing.
 */
export function reckonableInputsOf(
  topic: string,
  field: string,
): readonly GeneratedReckonableInput[] | undefined {
  return reckonableValuesOf(topic).find((row) => row.field === field)?.inputs;
}

/**
 * How the contract spells one declared input, rebuilt from its two halves.
 *
 * The generated rows carry the topic and the path separately so a consumer
 * resolves a dep without parsing, but a decline names the input to an OPERATOR,
 * and the string they see should be the string the contract carries:
 * `relativeVelocity`, `@system.bodies`, `@vessel.orbit#mu`.
 */
export function reckonableInputSpelling(
  input: GeneratedReckonableInput,
): string {
  if (input.topic === "") return input.path;
  return input.path === ""
    ? `@${input.topic}`
    : `@${input.topic}#${input.path}`;
}
