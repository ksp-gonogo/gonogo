import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  RealFuelsBoiloff,
  RealFuelsEngines,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

// `realfuels.available` is a bare JSON boolean with no contract payload type
// behind it, so it is declared client-side (see the SDK topics.ts header). The
// two structured Topics ARE declared in C# and generated, in THIS Uplink's own
// contract slice rather than the SDK's, so the SDK knows nothing of them either
// and both are bare-registered here with their real generated types.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "realfuels.available": boolean;
    "realfuels.engines": RealFuelsEngines;
    "realfuels.boiloff": RealFuelsBoiloff;
  }
}

export const REALFUELS_AVAILABLE_TOPIC = "realfuels.available";
export const REALFUELS_ENGINES_TOPIC = "realfuels.engines";
export const REALFUELS_BOILOFF_TOPIC = "realfuels.boiloff";

registerBarePrimitiveTopic(REALFUELS_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(REALFUELS_ENGINES_TOPIC);
registerBarePrimitiveTopic(REALFUELS_BOILOFF_TOPIC);

// The runtime half, and this Domain needs BOTH registries.
//
// `registerTopicUnits` covers a Topic's OWN fields, which for `realfuels.engines`
// is only its two switches: every unit an operator reads sits on the nested
// per-engine rows. `wrapTopicPayload` learns from the shape map that `engines`
// holds another type, then resolves that type BY NAME through the type registry,
// so without the `registerTypeUnits` loop every stability, probability, residual
// fraction and rated burn time would arrive as a bare number while
// ../__generated__/contract.ts still types it Value<...>.
//
// Driven by looping over the generated maps rather than naming each entry, so a
// type or Topic added to this Uplink's contract later needs no new call site.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * A compile-time invariant, checked by `pnpm build` and `pnpm typecheck`: it
 * proves the augmentation above is in-program and resolves each Topic to its
 * real payload type rather than the `unknown` a missing augmentation leaves
 * behind. Inline and type-only (so it is erased at runtime) rather than in a
 * `.test-d.ts`, which the build tsconfig does not exclude and would emit into
 * `dist`.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesRealFuelsAvailable = Expect<
  Equal<TopicPayload<"realfuels.available">, boolean>
>;
export type _ResolvesRealFuelsEngines = Expect<
  Equal<TopicPayload<"realfuels.engines">, RealFuelsEngines>
>;
export type _ResolvesRealFuelsBoiloff = Expect<
  Equal<TopicPayload<"realfuels.boiloff">, RealFuelsBoiloff>
>;
