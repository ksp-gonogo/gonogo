// Typed Topic registry — Uplink architecture spec §3.1.
//
// Exports a `TopicId` string-literal union of every Topic the mod declares, plus a
// `TopicPayload<T extends TopicId>` mapped type resolving each Topic to its wire
// payload interface (e.g. `TopicPayload<'vessel.orbit'>` = `VesselOrbit`). Every place
// that names a Topic — widget `channels`/`optionalChannels` declarations and the
// `useTelemetry` read hook — is constrained to this union and shares the same token,
// so there are no open string keys and no drift.
//
// ── Single source of truth (CODEGEN) ────────────────────────────────────────────────
// The bulk of this registry — `GeneratedTopicPayloadMap` and `GENERATED_TOPIC_IDS` in
// `./__generated__/topic-map.ts` — is GENERATED from `Sitrep.Contract`: every wire
// payload type is tagged `[SitrepTopic("<topic>")]`, and `mod/codegen.sh` (via
// `RtConfig.EmitTopicMap`) reflects over those tags to emit both the payload interfaces
// (`contract.ts`) and the Topic→payload map (`topic-map.ts`). A Topic added or removed
// in C# therefore flows through codegen into this file with no hand edit; `topics.test.ts`
// additionally re-reads the C# `const string …Topic` declarations and asserts `TOPIC_IDS`
// stays in exact sync.
//
// ── The scansat tail (NOT codegen-derived) ──────────────────────────────────────────
// One Topic has no `Sitrep.Contract` payload TYPE to reflect, so it is declared by hand
// below rather than generated — deliberately, because a fabricated contract type would
// misrepresent the wire (the CRITICAL "mirror the exact serialized shape" rule):
//   • `scansat.available` is a bare JSON boolean (the uplink publishes `true`/`false`
//     directly — see GonogoScansatUplink/ScansatUplink.cs), not an object, so there is
//     no named payload type; it resolves to `boolean`.
// (`scansat.scanningVessels` was previously in this tail as `unknown[]` while its element
// shape was deferred; it now carries the wire-typed `ScanningVesselEntry` contract and is
// codegen-derived like every other array Topic.)
// It does not resolve to `unknown` — the registry has no `unknown` Topics (proven at
// compile time by `_AssertNoTopicResolvesToUnknown` below).

import type { GeneratedTopicPayloadMap } from "./__generated__/topic-map";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";

/**
 * The one SCANsat Topic whose payload is a bare JSON primitive, so it carries no named
 * `Sitrep.Contract` type and is not part of the generated map (see the "scansat tail"
 * note above). Merged into `TopicPayloadMap` alongside the generated entries.
 */
export interface ScansatTopicPayloadMap {
  "scansat.available": boolean;
}

/**
 * The Topic → payload-type map. Keys are the wire Topic strings; values are the payload
 * a `stream-data` message on that Topic carries. The generated entries come from
 * `Sitrep.Contract`'s `[SitrepTopic]` tags; the two scansat entries are hand-declared
 * (see the file header). `TopicId` and `TopicPayload` are both derived from this map.
 */
export interface TopicPayloadMap
  extends GeneratedTopicPayloadMap,
    ScansatTopicPayloadMap {}

/** Every Topic the mod declares, as a string-literal union. */
export type TopicId = keyof TopicPayloadMap;

/** The payload interface carried by `stream-data` messages on Topic `T`. */
export type TopicPayload<T extends TopicId> = TopicPayloadMap[T];

/**
 * Runtime list of every `TopicId` — the generated ids plus the hand-declared scansat
 * tail. Kept in lock-step with `TopicPayloadMap` by the compile-time assertions below,
 * and with the C# declarations by `topics.test.ts`. Dynamic namespaces (e.g. the
 * per-CPU `kos.compute.*` prefix or `scansat.coverage.*`) are intentionally NOT
 * enumerated here — a runtime-computed sub-topic has no fixed member in the union.
 */
export const TOPIC_IDS = [
  ...GENERATED_TOPIC_IDS,
  "scansat.available",
] as const satisfies readonly TopicId[];

const TOPIC_ID_SET: ReadonlySet<string> = new Set(TOPIC_IDS);

/** Runtime narrowing guard: is `value` a declared `TopicId`? */
export function isTopicId(value: string): value is TopicId {
  return TOPIC_ID_SET.has(value);
}

// ── Compile-time invariants (checked by `pnpm typecheck`) ───────────────────────────
// These bind the runtime `TOPIC_IDS` array to the `TopicPayloadMap` type in both
// directions and prove that no Topic resolves to `unknown` — so a drift between the
// array and the map, or a Topic slipping back to `unknown`, is a build error rather
// than a silent runtime bug.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type AssertTrue<T extends true> = T;
type AssertNever<T extends never> = T;

// `TOPIC_IDS` must list exactly the keys of `TopicPayloadMap` (no missing, no extra).
type _MissingFromRuntime = Exclude<TopicId, (typeof TOPIC_IDS)[number]>;
type _ExtraInRuntime = Exclude<(typeof TOPIC_IDS)[number], TopicId>;
export type _AssertNoMissingTopics = AssertNever<_MissingFromRuntime>;
export type _AssertNoExtraTopics = AssertNever<_ExtraInRuntime>;

// No Topic resolves to `unknown`. `IsUnknown<T>` is true ONLY for exactly `unknown`
// (excluding `any`, for which `unknown extends T` is also true); mapping it over every
// Topic and collapsing to a union yields `false` iff every payload is a real type — a
// single `unknown` payload would widen the union to `boolean` and fail the assert.
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true ? false : unknown extends T ? true : false;
type _AnyTopicResolvesToUnknown = {
  [K in TopicId]: IsUnknown<TopicPayload<K>>;
}[TopicId];
export type _AssertNoTopicResolvesToUnknown = AssertTrue<
  Equal<_AnyTopicResolvesToUnknown, false>
>;
