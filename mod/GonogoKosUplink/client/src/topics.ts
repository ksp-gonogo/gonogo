// KosUplink client-owned Topic registration: the one static kOS Topic, and both
// halves of its unit registry.
//
// `KosProcessorInfo` lives in THIS Uplink's own contract slice
// (GonogoKosUplink.Contract), not Sitrep.Contract, so the SDK generates nothing
// for `kos.processors` and both halves are registered here:
//
//   • TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds the
//     Topic to `TopicPayloadMap`, so `useTelemetry("kos.processors")` resolves to
//     `KosProcessorInfo[]` in any program that statically imports this module.
//   • RUNTIME: `registerBarePrimitiveTopic(...)` at module load feeds the SDK's
//     runtime registry, so `isTopicId` / `getAllKnownTopicIds` enumerate it
//     without the SDK ever naming the string.
//
// `index.ts` RE-EXPORTS this module (rather than importing it for side effect
// alone) so the augmentation reaches the emitted `dist/index.d.ts`: see that
// file's own comment.
//
// ## Why this Uplink registers ONE Topic against eleven relocated types
//
// Only `KosProcessorInfo` carries `[SitrepTopic]`. The other ten are the
// payloads of DYNAMIC channels and of commands, and neither can have a static
// Topic entry:
//
//   kos.terminal.<coreId>       KosTerminalFrame   one channel per CPU
//   kos.run.<coreId>            KosRunResult       one channel per CPU
//   kos.compute.<id>.status     KosComputeStatus   one per compute topic id
//   (seven command args)                           inbound only
//
// A runtime-computed sub-topic has no fixed member in the Topic union, which the
// SDK's own `TOPIC_IDS` doc states as a deliberate exclusion. The widgets that
// read those channels type the payload at the call site
// (`useStreamEvent<KosTerminalFrame>(\`kos.terminal.${coreId}\`)`), which is the
// established pattern for a dynamic namespace and is unchanged by the
// relocation.
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type { KosProcessorInfo } from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

/**
 * The kOS CPU discovery Topic (an array channel). Its value MUST match
 * `KosChannels.ProcessorsTopic` in ../../KosChannels.cs: `topics.test.ts`
 * asserts that.
 */
export const KOS_PROCESSORS_TOPIC = "kos.processors";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "kos.processors": KosProcessorInfo[];
  }
}

registerBarePrimitiveTopic(KOS_PROCESSORS_TOPIC);

// The runtime half of the relocation. Both registries are fed, by looping over
// the generated maps rather than naming entries, so a Topic or type added to
// this Uplink's contract later needs no new call site here.
//
// ## What these two calls carry TODAY, stated rather than implied
//
// This slice is the thinnest of the six on units, and pretending otherwise would
// set up a future reader to hunt a bug that is not there.
//
//   • `registerTopicUnits` restores `unitsForTopic("kos.processors")`, which
//     returned the six declared tokens out of the SDK's own generated map before
//     the relocation and would return `{}` after it without this call. All six
//     are NON-QUANTITY tokens (`id`/`text`/`flag`): a CPU list is identifiers
//     and state names. So `wrapTopicPayload` wraps nothing on this Topic either
//     way, by the same rule that leaves a vessel name alone. The registration
//     restores the LOOKUP, which is public SDK surface (`unitOf` /
//     `unitsForTopic`), not a hydration.
//   • `registerTypeUnits` restores `unitsForType`, and the one entry in this
//     slice that names a real dimension lives there:
//     `KosComputeStatus.lastGoodAt` (`"s"`, typed `Value<"s">` in
//     ./__generated__/contract.ts). It is reached by no Topic's shape map,
//     because `kos.compute.<id>.status` is a dynamic name, so nothing decodes
//     through it today; that was already true while the type lived in core.
//     Registering it keeps the type-keyed lookup honest for the moment something
//     does.
//   • `GENERATED_TYPE_SHAPES`/`GENERATED_TOPIC_SHAPES` are both EMPTY for this
//     slice: nothing here nests. `KosRunResult.fields` is the closest thing and
//     is deliberately not a shape, it is whatever a kerboscript printed.
//
// `topics.test.ts` therefore asserts the REGISTRY contents rather than a
// decode-time hydration, and asserts the bare decode is bare for the stated
// reason. Deleting either loop below turns a specific assertion there red.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * A compile-time invariant, checked by `pnpm build` and `pnpm typecheck`: it
 * proves the augmentation above is in-program and resolves the Topic to its real
 * payload type, rather than the `unknown` a missing augmentation would leave
 * behind.
 *
 * This is the per-Uplink half of the SDK's `_AssertNoTopicResolvesToUnknown`,
 * devolved here because the SDK leaf cannot see this augmenting module. It stays
 * inline, being type-only and erased at runtime, rather than moving to a
 * `.test-d.ts`: the client's build tsconfig does not exclude `*.test-d.ts`, so
 * a separate file would be emitted into `dist`.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesKosProcessors = Expect<
  Equal<TopicPayload<"kos.processors">, KosProcessorInfo[]>
>;
