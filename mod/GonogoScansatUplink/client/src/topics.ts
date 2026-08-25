// SCANsat Uplink: Topic ownership, both the bare primitive and the relocated
// structured payloads.
//
// `scansat.available` is a bare JSON boolean (the Uplink's source publishes `true`/`false`
// directly: see ../ScansatUplink.cs's `AvailableTopic`), so it has no named payload type
// for codegen to reflect. It is ALSO owned solely by this Uplink. Rather than hand-declare
// the mod token in the shared, mod-agnostic `@ksp-gonogo/sitrep-sdk` facade (the exact
// "mod-specific line in a generic file" leak the Uplink decoupling exists to kill), this
// Uplink's own client package owns it, in two halves that mirror the `SlotRegistry` /
// `registerComponent` split:
//
//   • TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds the Topic to
//     `TopicPayloadMap`, so `useTelemetry("scansat.available")` resolves to `boolean` in
//     any program that statically imports this module (the accepted Option-A trade-off:
//     a dynamically-loaded Uplink never statically imported types it `unknown` until load).
//   • RUNTIME: `registerBarePrimitiveTopic(...)` at module load feeds the SDK's runtime
//     registry, so `isTopicId` / `getAllKnownTopicIds` enumerate it without the SDK ever
//     naming the string.
//
// `scansat.scanningVessels` and `scansat.science` carry types from THIS
// Uplink's own contract slice (GonogoScansatUplink.Contract's
// ScanningVesselEntry/ScanScienceEntry), not from Sitrep.Contract, so the SDK
// generates nothing for them and they are registered here alongside
// `scansat.available`, with real generated payload types behind them rather
// than `boolean`.
//
// `index.ts` imports this module for its side effect (the registrations + the ambient
// augmentation), so importing the package wires every half.

import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  ScanningVesselEntry,
  ScanScienceEntry,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";

/**
 * The bare-boolean presence-gate Topic this Uplink publishes. Its value MUST match
 * `ScansatUplink.AvailableTopic` in ../ScansatUplink.cs: `topics.test.ts` asserts that.
 */
export const SCANSAT_AVAILABLE_TOPIC = "scansat.available";

/**
 * The cross-vessel scanning-fleet Topic. Its value MUST match
 * `ScansatUplink.ScanningVesselsTopic` in ../ScansatUplink.cs: `topics.test.ts`
 * asserts that.
 */
export const SCANSAT_SCANNING_VESSELS_TOPIC = "scansat.scanningVessels";

/**
 * The per-part map-experiment Topic. Its value MUST match
 * `ScansatUplink.ScienceTopic` in ../ScansatUplink.cs: `topics.test.ts` asserts that.
 */
export const SCANSAT_SCIENCE_TOPIC = "scansat.science";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "scansat.available": boolean;
    "scansat.scanningVessels": ScanningVesselEntry[];
    "scansat.science": ScanScienceEntry[];
  }
}

registerBarePrimitiveTopic(SCANSAT_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(SCANSAT_SCANNING_VESSELS_TOPIC);
registerBarePrimitiveTopic(SCANSAT_SCIENCE_TOPIC);

// The runtime half. ScanningVesselEntry/ScanScienceEntry live in THIS Uplink's
// contract slice, so the SDK's own generated unit map knows nothing about them
// and cannot hydrate these two Topics' Value<"°">/Value<"m"> fields. This
// Uplink therefore feeds its own generated unit/shape entries into the SDK's
// runtime registry (see sitrep-sdk's units.ts doc comments on
// registerTopicUnits/registerTypeUnits). Without it, subLatitude/subLongitude/
// altitude/groundTrackWidthDeg/groundTrackLonHalfDeg arrive as bare numbers at
// runtime while the TYPE still says Value<"°">/Value<"m">.
//
// BOTH registries, not just the topic one, and that is the part the three earlier
// relocations did not need. Their payloads were flat, so a topic-keyed unit map was
// the whole job. ScanningVesselEntry is not flat: `sensors` holds
// ScanSensorEntry[] and `trackColor` a ScanTrackColor, and wrapTopicPayload
// resolves a nested shape BY TYPE NAME through unitsForType/shapesForType. Register
// only the topics and every sensor's fov/minAlt/maxAlt/bestAlt silently stays a bare
// number, which is exactly the decode-level failure topics.test.ts pins down.
//
// Driven by looping over the generated maps rather than naming each entry, so a type
// or Topic added to this Uplink's contract later needs no new call site here.
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
export type _ResolvesScansatAvailable = Expect<
  Equal<TopicPayload<"scansat.available">, boolean>
>;
export type _ResolvesScansatScanningVessels = Expect<
  Equal<TopicPayload<"scansat.scanningVessels">, ScanningVesselEntry[]>
>;
export type _ResolvesScansatScience = Expect<
  Equal<TopicPayload<"scansat.science">, ScanScienceEntry[]>
>;
