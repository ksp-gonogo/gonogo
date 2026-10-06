// Typed Topic registry.
//
// Exports a `TopicId` string-literal union of every Topic the mod declares, plus a
// `TopicPayload<T extends TopicId>` mapped type resolving each Topic to its wire
// payload interface (e.g. `TopicPayload<'vessel.orbit'>` = `VesselOrbit`). Every place
// that names a Topic: widget `channels`/`optionalChannels` declarations and the
// `useTelemetry` read hook, is constrained to this union and shares the same token,
// so there are no open string keys and no drift.
//
// ── Single source of truth (CODEGEN) ────────────────────────────────────────────────
// The bulk of this registry (`GeneratedTopicPayloadMap` and `GENERATED_TOPIC_IDS` in
// `./__generated__/topic-map.ts`) is GENERATED from `Sitrep.Contract`: every wire
// payload type is tagged `[SitrepTopic("<topic>")]`, and `mod/codegen.sh` (via
// `RtConfig.EmitTopicMap`) reflects over those tags to emit both the payload interfaces
// (`contract.ts`) and the Topic→payload map (`topic-map.ts`). A Topic added or removed
// in C# therefore flows through codegen into this file with no hand edit; `topics.test.ts`
// additionally re-reads the C# `const string ...Topic` declarations and asserts `TOPIC_IDS`
// stays in exact sync.
//
// ── The hand-declared tail (NOT codegen-derived) ────────────────────────────────────
// Two ENGINE-OWNED Topics have no `Sitrep.Contract` payload TYPE to reflect, so they are
// declared by hand below rather than generated, deliberately, because a fabricated
// contract type would misrepresent the wire (the CRITICAL "mirror the exact serialized
// shape" rule):
//   • `system.uplinks` is the engine-aggregated Uplink roster/health channel, declared
//     by `ChannelEngine` itself and built as a dictionary in `BuildSystemUplinksPayload`
//     (no `[SitrepTopic]` type), so its structured shape is hand-mirrored here.
//   • `system.uplink.pending` is the engine-declared in-transit command queue; its
//     payload IS a real reflected contract type (`PendingUplinkQueue`), but `ChannelEngine`
//     (not any one Uplink's contract) declares the Topic, so it is hand-mapped here.
// Both are owned by the engine, not by any single Uplink, so they belong in the shared SDK.
// Neither resolves to `unknown`: the registry has no `unknown` Topics at all, proven at
// compile time by `_AssertNoTopicResolvesToUnknown` below.
//
// ── Bare-primitive Uplink Topics (NOT in the shared SDK) ─────────────────────────────
// A few Topics carry a bare JSON primitive (`true`/`false`), so they have no named C#
// payload type to reflect AND (unlike the engine tail above) they are OWNED BY A SINGLE
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

import type {
  ChannelEmissionReport,
  CommandGateReport,
  PendingUplinkQueue,
} from "./__generated__/contract";
import type { GeneratedTopicPayloadMap } from "./__generated__/topic-map";
import {
  GENERATED_COLLECTION_TOPIC_IDS,
  GENERATED_TOPIC_IDS,
} from "./__generated__/topic-map";
import {
  noteRuntimeTopic,
  noteRuntimeTopicMetadata,
} from "./runtime-topic-registry";

/**
 * `system.uplinks`: the engine-aggregated Uplink roster/health channel.
 * `ChannelEngine` declares it directly (not any one Uplink's contract) and
 * builds it as a dictionary in `BuildSystemUplinksPayload`, so it carries no
 * `[SitrepTopic]` payload TYPE to reflect and is hand-declared here, mirroring
 * the exact serialized wire shape. `health.state` is the integer ordinal of
 * `UplinkHealthState` (0 Healthy / 1 Degraded / 2 Unavailable); the client
 * decodes it in `uplink-health.ts`.
 */
export interface SystemUplinksTopicPayloadMap {
  "system.uplinks": {
    uplinks: Array<{
      id: string;
      version: string;
      available: boolean;
      reason: string | null;
      /**
       * H_mod: the client-bundle sha256 the running mod vouches for. `null` for
       * a mod-only Uplink (no client half) or an older mod that predates the
       * two-pass hash bake. Hand-declared here (not codegen) because
       * `system.uplinks` is engine-built, not a `[SitrepTopic]` reflected
       * payload.
       */
      expectedClientHash: string | null;
      /**
       * Where the Uplink's CLIENT bundle lives (D5), its distributable `url`
       * plus an optional `devPath` (a localhost dev-server URL or local build
       * dir for a third-party dev loop). `null` for a mod-only Uplink with no
       * client half. Hand-declared here (not codegen) for the same reason as
       * the rest of this shape: `system.uplinks` is engine-built, not a
       * `[SitrepTopic]` reflected payload. The bundle's integrity hash is NOT
       * repeated here; it stays on `expectedClientHash` (the loader's three-way
       * check reads it there).
       */
      clientSource: { url: string; devPath: string | null } | null;
      /**
       * Provenance the mod declares, for the consent dialog: an operator being
       * asked to execute a bundle from a URL they did not choose is told who
       * wrote it and where to look. `null` when the Uplink does not say, which
       * includes every mod built before the fields existed.
       */
      name: string | null;
      author: string | null;
      repo: string | null;
      /**
       * The contract version this Uplink declared it was built against, read off
       * its `[SitrepUplink]` attribute. An Uplink REFUSED for a contract-major
       * mismatch rides the roster too, as a present-and-refused entry with
       * `available: false` and the refusal as its `reason`; these two fields are
       * what let a client say which version it wanted against `coreContractMajor`
       * below. `null` for an Uplink registered outside discovery, absent on a mod
       * build predating the fields.
       */
      contractMajor?: number | null;
      contractMinor?: number | null;
      /**
       * `state` is the integer ordinal of `UplinkHealthState`; `detail` the
       * Uplink's own sentence about it. `facts` is the identity of whatever the
       * Uplink depends on, labelled by the Uplink and read by nothing: a client
       * lists the rows without knowing what any of them mean, which is what
       * lets an Uplink publish its dependency's build and hash without a topic
       * or a payload type of its own. Present and empty for an Uplink with
       * nothing to add.
       */
      health: {
        state: number;
        detail: string | null;
        facts: Array<{ label: string; value: string | null }>;
      };
    }>;
    /**
     * The contract version the running mod speaks. Stated once rather than per
     * entry, because it is a fact about the core. Absent on a mod build
     * predating the fields.
     */
    coreContractMajor?: number | null;
    coreContractMinor?: number | null;
    /**
     * Every registered channel's delay role, core and Uplink alike, each list
     * sorted. `trueNow` and `heldAtHome` name static topics; `trueNowPrefixes`
     * names the dynamic namespaces declared TrueNow, whose materialized topics
     * are not listed on their own. `addressed` names the topics whose samples
     * are each sent to a named audience and reach each listener after their own
     * journey, so they arrive already delayed; it is absent on a mod build
     * predating contract 28.6. A topic covered by none of them is delayed.
     * The client reads every lane from this, see `readDeclaredDelayRoles`.
     * Absent on a mod build predating contract 16.13.
     */
    delayRoles?: {
      trueNow: string[];
      heldAtHome: string[];
      trueNowPrefixes: string[];
      addressed?: string[];
    };
  };
}

/**
 * `system.uplink.pending`: the in-transit command queue (prediction-only
 * bookkeeping). `ChannelEngine` declares it directly (not any one Uplink's
 * contract), so like `system.uplinks` it carries no `[SitrepTopic]` payload
 * TYPE to reflect and is hand-declared here. Its payload IS a real reflected
 * contract type (`PendingUplinkQueue`), so this maps to that generated
 * interface rather than re-describing the shape inline.
 */
export interface SystemUplinkPendingTopicPayloadMap {
  "system.uplink.pending": PendingUplinkQueue;
}

/**
 * `system.uplink.gates`: every gated command's CURRENT verdict, evaluated with
 * no arguments, so a control knows it is gated before it is pressed.
 * `ChannelEngine` declares it directly (not any one Uplink's contract), so like
 * `system.uplinks` and `system.uplink.pending` it is hand-mapped here; its
 * payload IS a real reflected contract type, so this maps to the generated
 * interface rather than re-describing it.
 *
 * Not a permission. The snapshot is up to half a second old and the DISPATCH
 * re-evaluates the same gates against live state, so an out-of-date `Pass`
 * never lets a command through. It exists to say no in advance, never to say
 * yes.
 */
export interface SystemUplinkGatesTopicPayloadMap {
  "system.uplink.gates": CommandGateReport;
}

/**
 * `system.units`: the contract's own unit knowledge, so the stream describes
 * itself.
 *
 * Everything else the unit system knows is a TypeScript artifact and none of
 * it survives the wire: a consumer that is not TypeScript receives
 * `{"heatShieldFlux": 3400.0}` and has no way to learn it is kilowatts. The
 * mod reflects this off `Sitrep.Contract` at startup and serves it here, so
 * anyone who can reach the stream can reach its units.
 *
 * A STRING carrying JSON, not a structured payload: the document describes
 * this contract's own types, so giving it a contract type would put it inside
 * the thing it describes. Its schema is its own `version` field.
 *
 * A TypeScript consumer does not need this: the generated maps and the
 * decode-time wrap already give it `Value`s. It is for everyone else, and for
 * a generator in another language.
 */
export interface SystemUnitsTopicPayloadMap {
  "system.units": string;
}

/**
 * `system.channels`: every declared channel's emission counters, so a Topic that
 * is silent can say WHICH silence it is. Hand-mapped here for the same reason as
 * the three above: `ChannelEngine` declares it directly, because only the engine
 * sees the emitter, the subscription registry, the birth set and the
 * availability map at once, and the report is the four of them read together.
 *
 * From outside the mod, a Topic that never delivers looks the same whether the
 * engine never considered it or considered it and the emitter declined every
 * value, and those two are completely different investigations.
 * `considered === 0` is the first; a `considered` that climbs while `emitted`
 * stays put is the second. The flags on each row say which upstream gate held a
 * never-considered channel back.
 *
 * Nothing subscribes until something asks, and the mod's mapper runs only while
 * the Topic has a subscriber.
 */
export interface SystemChannelsTopicPayloadMap {
  "system.channels": ChannelEmissionReport;
}

/**
 * The SDK's OWN Topic map: the generated entries plus the engine-owned tail
 * (`system.uplinks`, `system.uplink.pending`). DELIBERATELY distinct from the
 * public, augmentable `TopicPayloadMap` below: bare-primitive Uplink Topics
 * augment `TopicPayloadMap` (not this), so this interface stays fixed to
 * exactly what the SDK owns in EVERY program: augmented or not. The
 * compile-time invariants below bind `TOPIC_IDS` to THIS map (not the
 * augmentable one), so a downstream Uplink augmentation, which adds a key to
 * `TopicPayloadMap` and an id to the runtime registry, never to the static
 * `TOPIC_IDS` array: cannot turn the SDK's own array↔map assertions into false
 * failures.
 */
interface SdkOwnedTopicPayloadMap
  extends GeneratedTopicPayloadMap,
    SystemUplinksTopicPayloadMap,
    SystemUplinkPendingTopicPayloadMap,
    SystemUplinkGatesTopicPayloadMap,
    SystemUnitsTopicPayloadMap,
    SystemChannelsTopicPayloadMap {}

/**
 * Every Topic id mapped to the type of its payload. {@link TopicId} and
 * {@link TopicPayload} are read from it.
 *
 * An Uplink whose Topics are not in the Gonogo contract adds them by
 * augmenting this interface from its client package, and registers each id
 * at load with {@link registerBarePrimitiveTopic}:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface TopicPayloadMap {
 *     "myuplink.armed": boolean;
 *   }
 * }
 * ```
 *
 * @category Reading telemetry
 */
export interface TopicPayloadMap extends SdkOwnedTopicPayloadMap {}

/**
 * Every Topic the mod declares, as a string-literal union.
 *
 * @category Reading telemetry
 */
export type TopicId = keyof TopicPayloadMap;

/**
 * The payload interface carried by `stream-data` messages on Topic `Topic`.
 *
 * @category Reading telemetry
 */
export type TopicPayload<Topic extends TopicId> = TopicPayloadMap[Topic];

/**
 * Every Topic id the SDK itself declares, as an array.
 *
 * Topics an Uplink adds at load are not in it; {@link getAllKnownTopicIds}
 * and {@link isTopicId} include them. Topics whose id is built at runtime,
 * such as one per celestial body, are in neither.
 *
 * @category Reading telemetry
 */
export const TOPIC_IDS = [
  ...GENERATED_TOPIC_IDS,
  "system.uplinks",
  "system.uplink.pending",
  "system.uplink.gates",
  "system.units",
  "system.channels",
] as const satisfies readonly TopicId[];

const TOPIC_ID_SET: ReadonlySet<string> = new Set(TOPIC_IDS);

/**
 * Runtime registry of bare-primitive Topic ids, the ids that carry a naked JSON
 * boolean and so have no named C# payload type for the codegen to reflect. Most
 * are owned by a single Uplink rather than the shared SDK, and each owning
 * Uplink's client package calls `registerBarePrimitiveTopic` at module load
 * (mirrors the `registerComponent` self-registration idiom), so the SDK can
 * narrow/enumerate them without ever naming the mod token in this file. See the
 * file header's "Bare-primitive Uplink Topics" note.
 *
 * The first-party ones below are the exception, and they are named here because
 * they belong to no Uplink: core publishes them itself.
 */
const barePrimitiveTopicIds = new Set<string>();

/**
 * First-party Topics whose payload is a naked boolean.
 *
 * `Sitrep.Host` publishes both beside the structured record they summarise
 * (`crash.lastCrash`, `recovery.lastSummary`), and a bare bool has no payload
 * class, so neither appears in the generated Topic list however real it is.
 * Until now the only thing vouching for them was an identity entry in the
 * retiring migration table, which made a genuine wire Topic classify as a
 * legacy key and would have left a widget declaring one with nothing to resolve
 * against once that table went.
 */
const FIRST_PARTY_BARE_PRIMITIVE_TOPICS = [
  "crash.hasRecent",
  "recovery.hasRecent",
] as const;

for (const id of FIRST_PARTY_BARE_PRIMITIVE_TOPICS) {
  barePrimitiveTopicIds.add(id);
}

/**
 * Registers a Topic id that an Uplink adds and the SDK does not declare, so
 * {@link isTopicId} and {@link getAllKnownTopicIds} include it. Call it when
 * the Uplink's client package loads, beside its augmentation of
 * {@link TopicPayloadMap}. Registering an id twice does nothing.
 *
 * Named for the commonest case, a Topic whose payload is a bare boolean, but
 * any payload shape may be registered. A Topic with numeric fields also needs
 * {@link registerTopicUnits}.
 *
 * @category Reading telemetry
 */
export function registerBarePrimitiveTopic(id: string): void {
  barePrimitiveTopicIds.add(id);
  // The runtime registry is what the field catalogue reads, so this call is also what makes an Uplink's Topic pickable. See `runtime-topic-registry.ts`.
  noteRuntimeTopic(id);
}

/**
 * Core Topics carried on the binary lane. Their payload is byte segments, not a
 * contract type, so no generated map names them.
 */
const BINARY_TOPIC_IDS: readonly string[] = ["commcast.radio"];

/**
 * Every Topic id known now: {@link TOPIC_IDS}, the Topics carried as binary
 * data, and every id an Uplink has registered so far. An Uplink's Topics
 * appear once its client package has loaded.
 *
 * @category Reading telemetry
 */
export function getAllKnownTopicIds(): readonly string[] {
  return [...TOPIC_IDS, ...BINARY_TOPIC_IDS, ...barePrimitiveTopicIds];
}

/**
 * Returns whether `value` is a known {@link TopicId}: one the SDK declares, or
 * one an Uplink has registered with {@link registerBarePrimitiveTopic}.
 *
 * @category Reading telemetry
 */
export function isTopicId(value: string): value is TopicId {
  return TOPIC_ID_SET.has(value) || barePrimitiveTopicIds.has(value);
}

const collectionTopicIds = new Set<string>(GENERATED_COLLECTION_TOPIC_IDS);

/**
 * Registers an Uplink Topic whose payload is an array, so
 * {@link isCollectionTopic} reports it. Call it when the Uplink's client
 * package loads. Registering an id twice does nothing.
 *
 * The units and shapes registered for such a Topic describe one element, so
 * `<topic>.name` is a field of each element rather than of the Topic.
 *
 * @category Reading telemetry
 */
export function registerCollectionTopic(id: string): void {
  if (collectionTopicIds.has(id)) return;
  collectionTopicIds.add(id);
  noteRuntimeTopicMetadata();
}

/**
 * Whether `id`'s payload is a bare array of elements: an SDK-owned Topic the
 * contract marks as one, or an Uplink Topic registered through
 * {@link registerCollectionTopic}.
 *
 * A read of `<id>.<field>` walks into the array itself, which has no such
 * property, so a field path under a collection Topic never carries a value.
 *
 * @category Reading telemetry
 */
export function isCollectionTopic(id: string): boolean {
  return collectionTopicIds.has(id);
}

/**
 * The derived channels: values Gonogo computes in the browser from other
 * Topics, rather than ones the game publishes. A widget declares and reads one
 * exactly as it does a Topic, but it is not a {@link TopicId}.
 *
 * @category Reading telemetry
 */
// derived-channel-ids.test.ts holds this list equal to PRODUCTION_DERIVED_CHANNELS, whose ids the `as` cast there erases.
export const DERIVED_CHANNEL_IDS = [
  "system.state",
  "system.uplinkHealth",
  "spaceCenter.state",
  "dv.currentStageResource",
  "dv.currentStageResourceMax",
] as const;

/**
 * One of the client-side derived channels. See {@link DERIVED_CHANNEL_IDS}.
 *
 * @category Reading telemetry
 */
export type DerivedChannelId = (typeof DERIVED_CHANNEL_IDS)[number];

const DERIVED_CHANNEL_ID_SET: ReadonlySet<string> = new Set(
  DERIVED_CHANNEL_IDS,
);

/**
 * Returns whether `value` is a {@link DerivedChannelId}.
 *
 * @category Reading telemetry
 */
export function isDerivedChannelId(value: string): value is DerivedChannelId {
  return DERIVED_CHANNEL_ID_SET.has(value);
}

/**
 * What a widget may list in `channels` and `optionalChannels`: a
 * {@link TopicId} or a {@link DerivedChannelId}. Any other string does not
 * compile, and neither does a field path; list the channel that carries the
 * field.
 *
 * @category Reading telemetry
 */
export type WidgetChannelId = TopicId | DerivedChannelId;

/**
 * Returns whether `value` is a {@link WidgetChannelId}.
 *
 * @category Reading telemetry
 */
export function isWidgetChannelId(value: string): value is WidgetChannelId {
  return isTopicId(value) || isDerivedChannelId(value);
}

/**
 * One thing a widget draws: a whole channel, or a field inside one, such as
 * `"vessel.flight.altitudeAsl"`, as listed in {@link ComponentDefinition.fields}.
 *
 * It is separate from {@link WidgetChannelId}, which says what a widget mounts
 * on: a widget can mount on `vessel.flight` and draw three of its fields. A
 * bare channel means every field on it. A string that does not start with a
 * real channel id does not compile.
 *
 * @category Reading telemetry
 */
export type WidgetFieldPath = WidgetChannelId | `${WidgetChannelId}.${string}`;

// ── Compile-time invariants (checked by `pnpm typecheck`) ───────────────────────────
// These bind the runtime `TOPIC_IDS` array to the SDK-OWNED `SdkOwnedTopicPayloadMap` in
// both directions and prove that no SDK-owned Topic resolves to `unknown`, so a drift
// between the array and the map, or an SDK-owned Topic slipping back to `unknown`, is a
// build error rather than a silent runtime bug. They intentionally use the fixed
// SDK-owned map, NOT the augmentable `TopicPayloadMap`: a bare-primitive Uplink Topic that
// augments `TopicPayloadMap` is present in the type union but absent from `TOPIC_IDS` (it
// registers into the runtime set instead), that is BY DESIGN, so binding these asserts to
// the augmentable map would make them fail in any program that loads an Uplink client. Each
// augmented Topic proves its own resolution in its owning client package's `topics.ts`.

type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;
type AssertTrue<Condition extends true> = Condition;
type AssertNever<Leftover extends never> = Leftover;

// `TOPIC_IDS` must list exactly the SDK-owned keys (generated + engine tail), no missing, no extra.
type SdkOwnedTopicId = keyof SdkOwnedTopicPayloadMap;
type _MissingFromRuntime = Exclude<SdkOwnedTopicId, (typeof TOPIC_IDS)[number]>;
type _ExtraInRuntime = Exclude<(typeof TOPIC_IDS)[number], SdkOwnedTopicId>;
export type _AssertNoMissingTopics = AssertNever<_MissingFromRuntime>;
export type _AssertNoExtraTopics = AssertNever<_ExtraInRuntime>;

// `GENERATED_COLLECTION_TOPIC_IDS` must list exactly the SDK-owned Topics whose payload type is an array, so the runtime list and the `[]` in the payload map cannot disagree.
type SdkOwnedCollectionTopicId = {
  [Topic in SdkOwnedTopicId]: SdkOwnedTopicPayloadMap[Topic] extends readonly unknown[]
    ? Topic
    : never;
}[SdkOwnedTopicId];
type _CollectionMissingFromRuntime = Exclude<
  SdkOwnedCollectionTopicId,
  (typeof GENERATED_COLLECTION_TOPIC_IDS)[number]
>;
type _CollectionExtraInRuntime = Exclude<
  (typeof GENERATED_COLLECTION_TOPIC_IDS)[number],
  SdkOwnedCollectionTopicId
>;
export type _AssertNoMissingCollectionTopics =
  AssertNever<_CollectionMissingFromRuntime>;
export type _AssertNoExtraCollectionTopics =
  AssertNever<_CollectionExtraInRuntime>;

// No SDK-owned Topic resolves to `unknown`. `IsUnknown<Candidate>` is true ONLY for exactly
// `unknown` (excluding `any`, for which `unknown extends Candidate` is also true); mapping it over
// every SDK-owned Topic and collapsing to a union yields `false` iff every payload is a
// real type: a single `unknown` payload would widen the union to `boolean` and fail the
// assert.
type IsAny<Candidate> = 0 extends 1 & Candidate ? true : false;
type IsUnknown<Candidate> =
  IsAny<Candidate> extends true
    ? false
    : unknown extends Candidate
      ? true
      : false;
type _AnyTopicResolvesToUnknown = {
  [Topic in keyof SdkOwnedTopicPayloadMap]: IsUnknown<
    SdkOwnedTopicPayloadMap[Topic]
  >;
}[keyof SdkOwnedTopicPayloadMap];
export type _AssertNoTopicResolvesToUnknown = AssertTrue<
  Equal<_AnyTopicResolvesToUnknown, false>
>;
