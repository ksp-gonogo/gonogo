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
// Two ENGINE-OWNED Topics have no `Sitrep.Contract` payload TYPE to reflect, so they are
// declared by hand below rather than generated — deliberately, because a fabricated
// contract type would misrepresent the wire (the CRITICAL "mirror the exact serialized
// shape" rule):
//   • `system.uplinks` is the engine-aggregated Uplink roster/health channel, declared
//     by `ChannelEngine` itself and built as a dictionary in `BuildSystemUplinksPayload`
//     (no `[SitrepTopic]` type), so its structured shape is hand-mirrored here.
//   • `system.uplink.pending` is the engine-declared in-transit command queue; its
//     payload IS a real reflected contract type (`PendingUplinkQueue`), but `ChannelEngine`
//     (not any one Uplink's contract) declares the Topic, so it is hand-mapped here.
// Both are owned by the engine, not by any single Uplink, so they belong in the shared SDK.
// (A formerly-untyped array Topic that once sat in this tail as `unknown[]` while its
// element shape was deferred now carries its wire-typed element contract and is
// codegen-derived like every other array Topic.)
// It does not resolve to `unknown` — the registry has no `unknown` Topics (proven at
// compile time by `_AssertNoTopicResolvesToUnknown` below).
//
// ── Bare-primitive Uplink Topics (NOT in the shared SDK) ─────────────────────────────
// A few Topics carry a bare JSON primitive (`true`/`false`), so they have no named C#
// payload type to reflect AND — unlike the engine tail above — they are OWNED BY A SINGLE
// UPLINK, not the engine. Naming that Uplink's mod token in this shared, mod-agnostic file
// is the exact "mod-specific line in a generic file" leak the Uplink decoupling exists to
// kill, so such Topics do NOT live here. Instead each owning Uplink's own client package
// augments `TopicPayloadMap` (a `declare module "@ksp-gonogo/sitrep-sdk"` block, colocated
// with the Uplink) for the TYPE, and self-registers the id at module load via
// `registerBarePrimitiveTopic(...)` (mirrors the `registerComponent` idiom) for the
// RUNTIME. `isTopicId`/`getAllKnownTopicIds` read that registry, so the SDK stays correct
// without ever naming the string. Trade-off (accepted, matches the `SlotRegistry`
// precedent): a dynamically-loaded Uplink never statically imported by a type-checking
// entry point types its bare Topic `unknown` until loaded.

import type { PendingUplinkQueue } from "./__generated__/contract";
import type { GeneratedTopicPayloadMap } from "./__generated__/topic-map";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";

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
 * The SDK's OWN Topic map — the generated entries plus the engine-owned tail
 * (`system.uplinks`, `system.uplink.pending`). DELIBERATELY distinct from the public,
 * augmentable `TopicPayloadMap` below: bare-primitive Uplink Topics augment
 * `TopicPayloadMap` (not this), so this interface stays fixed to exactly what the SDK owns
 * in EVERY program — augmented or not. The compile-time invariants below bind `TOPIC_IDS`
 * to THIS map (not the augmentable one), so a downstream Uplink augmentation — which adds a
 * key to `TopicPayloadMap` and an id to the runtime registry, never to the static
 * `TOPIC_IDS` array — cannot turn the SDK's own array↔map assertions into false failures.
 */
interface SdkOwnedTopicPayloadMap
  extends GeneratedTopicPayloadMap,
    SystemUplinksTopicPayloadMap,
    SystemUplinkPendingTopicPayloadMap {}

/**
 * The Topic → payload-type map. Keys are the wire Topic strings; values are the payload
 * a `stream-data` message on that Topic carries. The generated entries come from
 * `Sitrep.Contract`'s `[SitrepTopic]` tags; the `system.uplinks`/`system.uplink.pending`
 * entries are the engine-owned hand-declared tail (see the file header). Bare-primitive
 * Uplink Topics are NOT here — each owning Uplink's client package augments this interface
 * via `declare module "@ksp-gonogo/sitrep-sdk"` (see the file header). `TopicId` and
 * `TopicPayload` are both derived from this map, so a
 * client that statically imports its Uplink's augmenting module sees the augmented Topic
 * in the union. This is the AUGMENTABLE surface; `SdkOwnedTopicPayloadMap` above is the
 * fixed SDK-owned subset the compile invariants pin `TOPIC_IDS` against.
 */
export interface TopicPayloadMap extends SdkOwnedTopicPayloadMap {}

/** Every Topic the mod declares, as a string-literal union. */
export type TopicId = keyof TopicPayloadMap;

/** The payload interface carried by `stream-data` messages on Topic `T`. */
export type TopicPayload<T extends TopicId> = TopicPayloadMap[T];

/**
 * Runtime list of the SDK's OWN `TopicId`s — the generated ids plus the engine-owned
 * hand-declared tail (`system.uplinks`, `system.uplink.pending`). Kept in lock-step with
 * `TopicPayloadMap`'s SDK-owned keys by the compile-time assertions below (within this
 * package's program the Uplink augmentations are not reachable, so `keyof TopicPayloadMap`
 * is exactly this set). Bare-primitive Uplink Topics register at load into
 * `barePrimitiveTopicIds` and are NOT in this array — use `getAllKnownTopicIds()` /
 * `isTopicId` for the live full set. Dynamic namespaces (e.g. the per-CPU `kos.compute.*`
 * prefix) are intentionally NOT enumerated here — a runtime-computed sub-topic has no
 * fixed member in the union.
 */
export const TOPIC_IDS = [
  ...GENERATED_TOPIC_IDS,
  "system.uplinks",
  "system.uplink.pending",
] as const satisfies readonly TopicId[];

const TOPIC_ID_SET: ReadonlySet<string> = new Set(TOPIC_IDS);

/**
 * Runtime registry of bare-primitive Uplink Topic ids — the ids that carry a naked JSON
 * boolean, so they have no named C# payload type and are owned by a single Uplink rather
 * than the shared SDK. Each owning Uplink's client package calls
 * `registerBarePrimitiveTopic` at module load (mirrors the `registerComponent`
 * self-registration idiom), so the SDK can narrow/enumerate them without ever naming the
 * mod token in this file. See the file header's "Bare-primitive Uplink Topics" note.
 */
const barePrimitiveTopicIds = new Set<string>();

/**
 * Self-register a bare-primitive Uplink Topic id. Called at module load by the owning
 * Uplink's client package alongside its `declare module` augmentation of
 * `TopicPayloadMap`. Idempotent (a `Set`), so a double import is harmless.
 */
export function registerBarePrimitiveTopic(id: string): void {
  barePrimitiveTopicIds.add(id);
}

/**
 * Every Topic id currently known at runtime — the SDK's own `TOPIC_IDS` plus every
 * bare-primitive Uplink Topic registered so far. The completeness-oriented counterpart to
 * `TOPIC_IDS`: consumers that want "subscribe to / iterate over EVERYTHING" (e.g. the
 * replay recorder's full-archive mode) read this, since the two bare topics are no longer
 * static members of `TOPIC_IDS`. Reflects only Uplinks whose client package has loaded.
 */
export function getAllKnownTopicIds(): readonly string[] {
  return [...TOPIC_IDS, ...barePrimitiveTopicIds];
}

/**
 * Runtime narrowing guard: is `value` a known `TopicId`? True for an SDK-owned Topic OR a
 * bare-primitive Uplink Topic whose owning client package has registered it.
 */
export function isTopicId(value: string): value is TopicId {
  return TOPIC_ID_SET.has(value) || barePrimitiveTopicIds.has(value);
}

// ── Compile-time invariants (checked by `pnpm typecheck`) ───────────────────────────
// These bind the runtime `TOPIC_IDS` array to the SDK-OWNED `SdkOwnedTopicPayloadMap` in
// both directions and prove that no SDK-owned Topic resolves to `unknown` — so a drift
// between the array and the map, or an SDK-owned Topic slipping back to `unknown`, is a
// build error rather than a silent runtime bug. They intentionally use the fixed
// SDK-owned map, NOT the augmentable `TopicPayloadMap`: a bare-primitive Uplink Topic that
// augments `TopicPayloadMap` is present in the type union but absent from `TOPIC_IDS` (it
// registers into the runtime set instead) — that is BY DESIGN, so binding these asserts to
// the augmentable map would make them fail in any program that loads an Uplink client. Each
// augmented Topic proves its own resolution in its owning client package's `topics.ts`.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type AssertTrue<T extends true> = T;
type AssertNever<T extends never> = T;

// `TOPIC_IDS` must list exactly the SDK-owned keys (generated + engine tail) — no missing,
// no extra.
type SdkOwnedTopicId = keyof SdkOwnedTopicPayloadMap;
type _MissingFromRuntime = Exclude<SdkOwnedTopicId, (typeof TOPIC_IDS)[number]>;
type _ExtraInRuntime = Exclude<(typeof TOPIC_IDS)[number], SdkOwnedTopicId>;
export type _AssertNoMissingTopics = AssertNever<_MissingFromRuntime>;
export type _AssertNoExtraTopics = AssertNever<_ExtraInRuntime>;

// No SDK-owned Topic resolves to `unknown`. `IsUnknown<T>` is true ONLY for exactly
// `unknown` (excluding `any`, for which `unknown extends T` is also true); mapping it over
// every SDK-owned Topic and collapsing to a union yields `false` iff every payload is a
// real type — a single `unknown` payload would widen the union to `boolean` and fail the
// assert.
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true ? false : unknown extends T ? true : false;
type _AnyTopicResolvesToUnknown = {
  [K in keyof SdkOwnedTopicPayloadMap]: IsUnknown<SdkOwnedTopicPayloadMap[K]>;
}[keyof SdkOwnedTopicPayloadMap];
export type _AssertNoTopicResolvesToUnknown = AssertTrue<
  Equal<_AnyTopicResolvesToUnknown, false>
>;
