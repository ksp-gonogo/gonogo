// GonogoRealAntennasUplink client-owned Topic registration: the three Topics
// only this Uplink can source, and both halves of the relocated unit registry.
//
// `comms.linkQuality` / `comms.dataRate` / `comms.linkMargin` used to be
// generated straight into `@ksp-gonogo/sitrep-sdk`, because their payload types
// sat inside Sitrep.Contract's Comms.cs. They moved into THIS Uplink's own
// contract slice (GonogoRealAntennasUplink.Contract, uplink-types-out-of-core
// plan, seventh and last step), so they are registered here instead:
//
//   • TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds them to
//     `TopicPayloadMap`, so `useTelemetry("comms.linkMargin")` resolves to
//     `CommsLinkMargin` in any program that statically imports this module.
//   • RUNTIME: `registerBarePrimitiveTopic(...)` at module load feeds the SDK's
//     runtime registry, so `isTopicId` / `getAllKnownTopicIds` enumerate them
//     without the SDK ever naming the strings.
//
// `index.ts` RE-EXPORTS this module (rather than importing it for side effect
// alone) so the augmentation reaches the emitted `dist/index.d.ts`: see that
// file's own comment.
//
// ## Why these three and not the rest of comms.*
//
// The comms family has two kinds of channel. Most of it is a SHARED shape that
// whichever backend wins the "comms" capability election fills: stock CommNet, or
// this Uplink's RaCommsBackend when RealAntennas is installed. Those stay in the
// SDK, generated from core, because they exist with or without this mod. These
// three are the ones no election can produce: they are declared in this Uplink's
// OWN manifest and published by it directly, and without RealAntennas installed
// they simply never emit. That is the line the relocation drew, and it is why
// this was a partial extract rather than a file move.
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  CommsDataRate,
  CommsLinkMargin,
  CommsLinkQuality,
  RealAntennasHopRate,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

/**
 * The Domain presence gate: a bare JSON boolean the RA uplink emits (TrueNow)
 * while RealAntennas is loaded. Its value MUST match
 * `RealAntennasUplink.AvailableTopic` in ../../RealAntennasUplink.cs. The RA
 * augments bind `requires: "realantennas"`, which resolves to this Topic, so
 * their detail composes into CommSignal only when RA is actually running.
 */
export const REALANTENNAS_AVAILABLE_TOPIC = "realantennas.available";

/**
 * Link margin normalised to 0..1. Its value MUST match
 * `RealAntennasUplink.LinkQualityTopic` in ../../RealAntennasUplink.cs:
 * `topics.test.ts` asserts that.
 */
export const COMMS_LINK_QUALITY_TOPIC = "comms.linkQuality";

/** Bidirectional throughput, read live off the RA CommNet graph. */
export const COMMS_DATA_RATE_TOPIC = "comms.dataRate";

/** Re-derived link budget: decibel margin plus whether the link closes. */
export const COMMS_LINK_MARGIN_TOPIC = "comms.linkMargin";

/**
 * Per-hop forward band rate: a BARE ARRAY of {@link RealAntennasHopRate}, one
 * entry per hop that has a readable rate, keyed by the same node ids
 * `comms.path` carries. Its value MUST match `RealAntennasUplink.HopRatesTopic`
 * in ../../RealAntennasUplink.cs. The `comm-signal.hop-rates` contribution (see
 * ./CommSignal/hopRates.ts) reads it and joins each rate onto the route the core
 * CommSignal schedule already renders, so CommSignal never names RealAntennas.
 */
export const REALANTENNAS_HOP_RATES_TOPIC = "realantennas.hopRates";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "realantennas.available": boolean;
    "comms.linkQuality": CommsLinkQuality;
    "comms.dataRate": CommsDataRate;
    "comms.linkMargin": CommsLinkMargin;
    "realantennas.hopRates": RealAntennasHopRate[];
  }
}

registerBarePrimitiveTopic(REALANTENNAS_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(COMMS_LINK_QUALITY_TOPIC);
registerBarePrimitiveTopic(COMMS_DATA_RATE_TOPIC);
registerBarePrimitiveTopic(COMMS_LINK_MARGIN_TOPIC);
registerBarePrimitiveTopic(REALANTENNAS_HOP_RATES_TOPIC);

// The runtime half of the relocation. Both registries are fed, by looping over
// the generated maps rather than naming entries, so a Topic or type added to
// this Uplink's contract later needs no new call site here.
//
// Unlike the slice before it, this one has real quantities to carry: a ratio, two
// bit rates and a decibel margin, four of the five declared units. So
// `registerTopicUnits` is not merely restoring a LOOKUP here, it is restoring
// HYDRATION: without it `wrapTopicPayload` hands back bare numbers while the
// generated types still say `Value<"dB">`, and a margin renders as "3.5" next to
// a ratio that also renders as "0.9". `topics.test.ts` proves that by decoding a
// real frame, which is the check the previous slice could not make.
//
// `registerTypeUnits` is the type-keyed half, wired for the same reason even
// though nothing in this slice nests today (`GENERATED_*_SHAPES` are both empty:
// the one nested shape in the comms family, CommsHop, hangs off CommsPath and
// stayed core with it). It is what a future nested payload here would need, and
// the loop form means it needs no edit when that happens.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * A compile-time invariant, checked by `pnpm build` and `pnpm typecheck`: it
 * proves the augmentation above is in-program and resolves each Topic to its
 * real payload type, rather than the `unknown` a missing augmentation would
 * leave behind.
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
export type _ResolvesRealAntennasAvailable = Expect<
  Equal<TopicPayload<"realantennas.available">, boolean>
>;
export type _ResolvesLinkQuality = Expect<
  Equal<TopicPayload<"comms.linkQuality">, CommsLinkQuality>
>;
export type _ResolvesDataRate = Expect<
  Equal<TopicPayload<"comms.dataRate">, CommsDataRate>
>;
export type _ResolvesLinkMargin = Expect<
  Equal<TopicPayload<"comms.linkMargin">, CommsLinkMargin>
>;
export type _ResolvesHopRates = Expect<
  Equal<TopicPayload<"realantennas.hopRates">, RealAntennasHopRate[]>
>;
