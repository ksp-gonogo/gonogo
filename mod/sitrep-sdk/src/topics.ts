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
// ── The hand-declared tail (NOT codegen-derived) ────────────────────────────────────
// Three Topics have no `Sitrep.Contract` payload TYPE to reflect, so they are declared by
// hand below rather than generated — deliberately, because a fabricated contract type
// would misrepresent the wire (the CRITICAL "mirror the exact serialized shape" rule):
//   • `scansat.available` is a bare JSON boolean (the uplink publishes `true`/`false`
//     directly — see GonogoScansatUplink/ScansatUplink.cs), not an object, so there is
//     no named payload type; it resolves to `boolean`.
//   • `kerbcast.available` is the same bare-boolean shape, for the same reason — see
//     GonogoKerbcastUplink/KerbcastUplink.cs. (`kerbcast.cameras` DOES carry a wire type,
//     `KerbcastCameraEntry`, so it is codegen-derived like every other array Topic.)
//   • `system.uplinks` is the engine-aggregated Uplink roster/health channel, declared
//     by `ChannelEngine` itself and built as a dictionary in `BuildSystemUplinksPayload`
//     (no `[SitrepTopic]` type), so its structured shape is hand-mirrored here.
// (`scansat.scanningVessels` was previously in this tail as `unknown[]` while its element
// shape was deferred; it now carries the wire-typed `ScanningVesselEntry` contract and is
// codegen-derived like every other array Topic.)
// It does not resolve to `unknown` — the registry has no `unknown` Topics (proven at
// compile time by `_AssertNoTopicResolvesToUnknown` below).

import type { PendingUplinkQueue } from "./__generated__/contract";
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
 * The one kerbcast Topic whose payload is a bare JSON primitive — the presence gate a
 * client augment declares `requires: "kerbcast"` against. Like `scansat.available` it
 * carries no named `Sitrep.Contract` type (the uplink's source is `_ => true` / `_ => false`,
 * so the wire is a naked boolean, not an object) and is therefore hand-declared here.
 *
 * kerbcast's camera CONTROL data rides `kerbcast.cameras` (generated, `KerbcastCameraEntry[]`);
 * its VIDEO does not ride the Topic stream at all — it stays on kerbcast's own WebRTC
 * path. See mod/GonogoKerbcastUplink/KerbcastUplink.cs.
 */
export interface KerbcastTopicPayloadMap {
  "kerbcast.available": boolean;
}

/**
 * `system.uplinks` — the engine-aggregated Uplink roster/health channel. `ChannelEngine`
 * declares it directly (not any one Uplink's contract) and builds it as a dictionary in
 * `BuildSystemUplinksPayload`, so it carries no `[SitrepTopic]` payload TYPE to reflect and
 * is hand-declared here, mirroring the exact serialized wire shape. `health.state` is the
 * integer ordinal of `UplinkHealthState` (0 Healthy / 1 Degraded / 2 Unavailable); the
 * client decodes it in `uplink-health.ts`.
 */
export interface SystemUplinksTopicPayloadMap {
  "system.uplinks": {
    uplinks: Array<{
      id: string;
      version: string;
      available: boolean;
      reason: string | null;
      /**
       * H_mod — the client-bundle sha256 the running mod vouches for (design §3.2/§3.3).
       * `null` for a mod-only Uplink (no client half) or an older mod that predates the
       * two-pass hash bake. Hand-declared here (not codegen) because `system.uplinks` is
       * engine-built, not a `[SitrepTopic]` reflected payload.
       */
      expectedClientHash: string | null;
      health: { state: number; detail: string | null };
    }>;
  };
}

/**
 * `system.uplink.pending` — the in-transit command queue (prediction-only bookkeeping).
 * `ChannelEngine` declares it directly (not any one Uplink's contract), so like
 * `system.uplinks` it carries no `[SitrepTopic]` payload TYPE to reflect and is
 * hand-declared here. Its payload IS a real reflected contract type (`PendingUplinkQueue`),
 * so this maps to that generated interface rather than re-describing the shape inline.
 */
export interface SystemUplinkPendingTopicPayloadMap {
  "system.uplink.pending": PendingUplinkQueue;
}

/**
 * The Topic → payload-type map. Keys are the wire Topic strings; values are the payload
 * a `stream-data` message on that Topic carries. The generated entries come from
 * `Sitrep.Contract`'s `[SitrepTopic]` tags; the `scansat.available` + `system.uplinks`
 * entries are hand-declared (see the file header). `TopicId` and `TopicPayload` are both
 * derived from this map.
 */
export interface TopicPayloadMap
  extends GeneratedTopicPayloadMap,
    ScansatTopicPayloadMap,
    KerbcastTopicPayloadMap,
    SystemUplinksTopicPayloadMap,
    SystemUplinkPendingTopicPayloadMap {}

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
  "kerbcast.available",
  "system.uplinks",
  "system.uplink.pending",
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
