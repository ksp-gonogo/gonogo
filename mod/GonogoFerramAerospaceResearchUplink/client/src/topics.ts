// The aero.* Topic registrations, both halves.
//
//   TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds each
//   Topic to `TopicPayloadMap`, so `useTelemetry("aero.state")` resolves to
//   `AeroState` in any program that statically imports this module.
//
//   RUNTIME: `registerBarePrimitiveTopic` feeds the SDK's runtime registry, so
//   `isTopicId` and the replay recorder know these strings without the SDK ever
//   naming one, and `registerTopicUnits` feeds the decode-time unit lookup that
//   turns a bare number on the wire into the `Value<>` the type promises.
//
// `aero.available` is a bare JSON boolean with no payload type, so it never
// flows through codegen and is declared by hand here, same as every other
// Domain presence gate.
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type { AeroState } from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
// Side-effect import, and load-bearing rather than tidiness: the unit maps below
// name `kg/m²` and `W/kg`, and `wrapTopicPayload` skips a field whose token has
// no model entry. Without this a widget imported on its own decodes those two
// fields as bare numbers and renders them as absent.
import "./units";

/**
 * A full-fidelity aerodynamics model is installed and readable. Its value must
 * match `FerramAerospaceResearchUplink.AvailableTopic`.
 */
export const AERO_AVAILABLE_TOPIC = "aero.available";

/**
 * The active vessel's aerodynamic state. Absent rather than zeroed on a vessel
 * the model holds no reading for, which is every craft in a scene it does not
 * run in.
 */
export const AERO_STATE_TOPIC = "aero.state";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "aero.available": boolean;
    "aero.state": AeroState;
  }
}

registerBarePrimitiveTopic(AERO_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(AERO_STATE_TOPIC);

// Driven by looping the generated maps rather than naming each entry, so a
// Topic added to this Uplink's contract later needs no new call site. Both
// registries: the topic-keyed one covers a payload's own fields, and the
// type-keyed one is what a nested shape resolves through.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * A compile-time invariant checked by `pnpm build` and `pnpm typecheck`: it
 * proves the augmentation above is in-program and resolves each Topic to its
 * real payload type rather than the `unknown` a missing augmentation leaves
 * behind. The per-Uplink half of the SDK's own assertion, devolved here because
 * the SDK cannot see this augmenting module.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesAeroAvailable = Expect<
  Equal<TopicPayload<"aero.available">, boolean>
>;
export type _ResolvesAeroState = Expect<
  Equal<TopicPayload<"aero.state">, AeroState>
>;
