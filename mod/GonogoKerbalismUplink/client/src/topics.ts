// KerbalismUplink client-owned Topic registration: the bare presence gate and
// the five relocated structured payload Topics.
//
// `kerbalism.available` is a bare JSON boolean the KerbalismUplink emits
// (DelayRole.TrueNow) as the Domain presence gate: it has no [SitrepTopic]
// payload POCO, so it never flows through codegen.
//
// `kerbalism.spaceweather` / `.profile` / `.lifesupport` / `.crew` / `.features`
// used to be generated straight into `@ksp-gonogo/sitrep-sdk`, because their
// payload types lived in Sitrep.Contract. They moved into THIS Uplink's own
// contract slice (GonogoKerbalismUplink.Contract, uplink-types-out-of-core plan,
// fifth relocation), so they are registered here too, the same two halves
// `kerbalism.available` already used, just with real generated payload types
// behind them instead of `boolean`:
//
//   • TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds each
//     Topic to `TopicPayloadMap`, so `useTelemetry("kerbalism.crew")` resolves to
//     `KerbalismCrewEntry[]` in any program that statically imports this module.
//   • RUNTIME: `registerBarePrimitiveTopic(...)` at module load feeds the SDK's
//     runtime registry, so `isTopicId` / `getAllKnownTopicIds` enumerate them
//     without the SDK ever naming the string.
//
// `index.ts` imports this module for its side effect (the registrations + the
// ambient augmentation), so importing the package wires every half.
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  KerbalismCrewEntry,
  KerbalismFeatures,
  KerbalismLifeSupport,
  KerbalismProfile,
  KerbalismSpaceWeather,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

/**
 * The bare-boolean presence-gate Topic. Its value MUST match
 * `KerbalismUplink.AvailableTopic` in ../KerbalismUplink.cs: `topics.test.ts`
 * asserts that, and so does the same file for each of the five below.
 */
export const KERBALISM_AVAILABLE_TOPIC = "kerbalism.available";

/** The vessel radiation/magnetosphere/storm situation Topic. */
export const KERBALISM_SPACEWEATHER_TOPIC = "kerbalism.spaceweather";

/** The loaded profile's own static definitions Topic. */
export const KERBALISM_PROFILE_TOPIC = "kerbalism.profile";

/** The vessel life-support ledger Topic. */
export const KERBALISM_LIFESUPPORT_TOPIC = "kerbalism.lifesupport";

/** The per-kerbal survival Topic (an array channel). */
export const KERBALISM_CREW_TOPIC = "kerbalism.crew";

/** The Kerbalism feature-toggle Topic. */
export const KERBALISM_FEATURES_TOPIC = "kerbalism.features";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "kerbalism.available": boolean;
    "kerbalism.spaceweather": KerbalismSpaceWeather;
    "kerbalism.profile": KerbalismProfile;
    "kerbalism.lifesupport": KerbalismLifeSupport;
    "kerbalism.crew": KerbalismCrewEntry[];
    "kerbalism.features": KerbalismFeatures;
  }
}

registerBarePrimitiveTopic(KERBALISM_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(KERBALISM_SPACEWEATHER_TOPIC);
registerBarePrimitiveTopic(KERBALISM_PROFILE_TOPIC);
registerBarePrimitiveTopic(KERBALISM_LIFESUPPORT_TOPIC);
registerBarePrimitiveTopic(KERBALISM_CREW_TOPIC);
registerBarePrimitiveTopic(KERBALISM_FEATURES_TOPIC);

// The runtime half of the relocation, and this Domain needs BOTH registries
// more than any relocated slice before it.
//
// `registerTopicUnits` covers a Topic's OWN fields. That is the whole job for a
// flat payload, and none of these five is flat:
//
//   kerbalism.spaceweather  stars: KerbalismStarInfo[], storms: KerbalismStormEntry[]
//   kerbalism.crew          rules: KerbalismCrewRule[]  (the per-kerbal dose lives HERE)
//   kerbalism.lifesupport   habitat, processes[], greenhouses[]
//   kerbalism.profile       resources{}, rules[], processes[]
//
// `wrapTopicPayload` learns from `shapesForTopic` that a field holds another
// shape, then recurses through `wrapTypePayload`, which resolves that shape BY
// TYPE NAME via `unitsForType`/`shapesForType`. Those read the SDK's TYPE-keyed
// generated maps, which no longer carry a single Kerbalism entry. So without the
// `registerTypeUnits` loop below, every per-kerbal rule dose, every per-star
// distance, every process capacity and every greenhouse flux would arrive as a
// BARE NUMBER while ../__generated__/contract.ts still types it Value<...>.
// `topics.test.ts` pins exactly that, at decode time through a real
// TelemetryClient, and asserts the two halves separately so neither can stand in
// for the other.
//
// KerbalismStarInfo.direction makes the type registry load-bearing one step
// further than the topic registry could ever reach: it is a Vec3 whose unit is
// declared on the FIELD and emitted as three dotted leaf keys
// ("direction.x"/".y"/".z"), on a type that is only ever reached through
// spaceweather's `stars` array. Two hops of shape resolution, then a fan-out to
// three leaves.
//
// Driven by looping over the generated maps rather than naming each entry, so a
// type or Topic added to this Uplink's contract later needs no new call site.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

// ── Compile-time invariant (checked by `pnpm build`/`typecheck`) ────────────────────
// Proves the augmentation above is in-program and resolves each Topic to its real payload
// type rather than the `unknown` a missing augmentation would leave. This is the per-Uplink
// half of the SDK's `_AssertNoTopicResolvesToUnknown`, devolved here because the SDK leaf
// cannot see this augmenting module (2026-07-20). Kept inline (type-only, erased at
// runtime) rather than in a `.test-d.ts`: the client's build tsconfig does not exclude
// `*.test-d.ts`, so a separate file would be emitted into `dist`.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesKerbalismAvailable = Expect<
  Equal<TopicPayload<"kerbalism.available">, boolean>
>;
export type _ResolvesKerbalismSpaceWeather = Expect<
  Equal<TopicPayload<"kerbalism.spaceweather">, KerbalismSpaceWeather>
>;
export type _ResolvesKerbalismProfile = Expect<
  Equal<TopicPayload<"kerbalism.profile">, KerbalismProfile>
>;
export type _ResolvesKerbalismLifeSupport = Expect<
  Equal<TopicPayload<"kerbalism.lifesupport">, KerbalismLifeSupport>
>;
export type _ResolvesKerbalismCrew = Expect<
  Equal<TopicPayload<"kerbalism.crew">, KerbalismCrewEntry[]>
>;
export type _ResolvesKerbalismFeatures = Expect<
  Equal<TopicPayload<"kerbalism.features">, KerbalismFeatures>
>;
