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
// `registerUplinkTopic(...)` (mirrors the `registerComponent` idiom) for the
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
import type { SampleKind } from "./contract-tags";
import {
  noteRuntimeTopic,
  noteRuntimeTopicMetadata,
} from "./runtime-topic-registry";

/**
 * `system.uplinks`: every Uplink the mod knows of, with its availability and
 * health. The mod builds it itself rather than any one Uplink's contract
 * declaring it, so its shape is written out here.
 */
export interface SystemUplinksTopicPayloadMap {
  /** Every Uplink the mod knows of, with its version, availability and health, and the contract version the mod itself speaks. */
  "system.uplinks": {
    uplinks: Array<{
      /** The Uplink's id, as its mod declares it with `[SitrepUplink]`. */
      id: string;
      /** The Uplink's version. */
      version: string;
      /** Whether the Uplink is loaded and serving its Topics. `false` for one the mod refused, with the refusal in `reason`. */
      available: boolean;
      /** Why the Uplink is not available, as a sentence, or `null` when it is. */
      reason: string | null;
      /**
       * The SHA-256 of the client bundle the running mod vouches for, which the
       * app compares with the bundle it loads. `null` for a mod-only Uplink
       * (no client half) or a mod build that predates the field.
       */
      expectedClientHash: string | null;
      /**
       * Where the Uplink's client bundle lives: its distributable `url`, and
       * for a development loop a `devPath`, a localhost dev-server URL or a
       * local build directory. `null` for a mod-only Uplink with no client
       * half. The bundle's hash is not repeated here; read it from
       * `expectedClientHash`.
       */
      clientSource: { url: string; devPath: string | null } | null;
      /**
       * Provenance the mod declares, shown when an operator is asked to run a
       * client bundle from a URL they did not choose: the Uplink's `name`, its
       * `author` and its source `repo`. `null` where the Uplink does not say.
       */
      name: string | null;
      author: string | null;
      repo: string | null;
      /**
       * The contract version this Uplink declared it was built against, read
       * from its `[SitrepUplink]` attribute. An Uplink refused for a major
       * version mismatch is listed too, with `available: false` and the
       * refusal as its `reason`; these two fields say which version it wanted,
       * to compare with `coreContractMajor`. `null` for an Uplink registered
       * outside discovery, and absent on a mod build that predates them.
       */
      contractMajor?: number | null;
      contractMinor?: number | null;
      /**
       * How well the Uplink is working: `state` is the ordinal of
       * `UplinkHealthState` (0 healthy, 1 degraded, 2 unavailable) and
       * `detail` the Uplink's own sentence about it. `facts` are labelled
       * rows the Uplink publishes about whatever it depends on, such as the
       * build of a mod it wraps. A client lists them without knowing what any
       * means. Empty for an Uplink with nothing to add.
       */
      health: {
        state: number;
        detail: string | null;
        facts: Array<{ label: string; value: string | null }>;
      };
      /**
       * Whether `settings.<id>` carries this Uplink's host mod settings, which
       * `useModSettings` reads. Absent on a mod build that predates mod
       * settings.
       */
      modSettings?: boolean;
    }>;
    /**
     * The contract version the running mod speaks, stated once because it is a
     * fact about the mod and not about any Uplink. Absent on a mod build that
     * predates the fields.
     */
    coreContractMajor?: number | null;
    coreContractMinor?: number | null;
    /**
     * The release the running mod was built as: a tag such as `v1.4.0`, or a
     * candidate label such as `rc-abc1234`. `null` for a build that records
     * none, which is every local build, and absent on a mod that predates the
     * field.
     */
    coreVersion?: string | null;
    /**
     * How every registered Topic is delayed, core and Uplink alike, each list
     * sorted. `trueNow` and `heldAtHome` name Topics; `trueNowPrefixes` names
     * namespaces whose Topics are all true now and are not listed one by one.
     * `addressed` names Topics whose samples are each sent to a named audience
     * and arrive already delayed by their own journey. A Topic in none of the
     * lists is delayed by the link's signal delay. Absent on a mod build that
     * predates the field.
     */
    delayRoles?: {
      trueNow: string[];
      heldAtHome: string[];
      trueNowPrefixes: string[];
      addressed?: string[];
    };
    /**
     * How a reader may draw between each Topic's samples, by Topic and, for a
     * namespace whose Topics are built at runtime, by prefix: `continuous`
     * moves between samples and can be drawn as a line, `discrete` stands until
     * the next and is a step, `event` is one occurrence per sample.
     */
    sampleKinds?: {
      topics: Record<string, SampleKind>;
      prefixes: Record<string, SampleKind>;
    };
  };
}

/**
 * `system.uplink.pending`: the in-transit command queue (prediction-only
 * bookkeeping). `ChannelEngine` declares it directly (not any one Uplink's
 * contract), so like `system.uplinks` it carries no `[SitrepTopic]` payload
 * type to reflect and is hand-declared here. Its payload is a real reflected
 * contract type (`PendingUplinkQueue`), so this maps to that generated
 * interface rather than re-describing the shape inline.
 */
export interface SystemUplinkPendingTopicPayloadMap {
  /** The commands sent and still on their way, with when each is predicted to arrive. */
  "system.uplink.pending": PendingUplinkQueue;
}

/**
 * `system.uplink.gates`: every gated command's current verdict, evaluated with
 * no arguments, so a control knows it is gated before it is pressed.
 * `ChannelEngine` declares it directly (not any one Uplink's contract), so like
 * `system.uplinks` and `system.uplink.pending` it is hand-mapped here; its
 * payload is a real reflected contract type, so this maps to the generated
 * interface rather than re-describing it.
 *
 * A `Pass` here does not permit a command. The snapshot is up to half a second
 * old and the dispatch re-evaluates the same gates against live state, so an
 * out-of-date `Pass` never lets a command through. Useful for disabling a
 * control that would be refused.
 */
export interface SystemUplinkGatesTopicPayloadMap {
  /** Each gated command and whether it would be accepted now. */
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
 * A string carrying JSON, not a structured payload: the document describes
 * this contract's own types, so giving it a contract type would put it inside
 * the thing it describes. Its schema is its own `version` field.
 *
 * A TypeScript consumer does not need this: the generated maps and the
 * decode-time wrap already give it `Value`s. It is for everyone else, and for
 * a generator in another language.
 */
export interface SystemUnitsTopicPayloadMap {
  /** A JSON document, as a string, describing every unit the contract uses. */
  "system.units": string;
}

/**
 * `system.channels`: every declared channel's emission counters, so a Topic that
 * is silent can say which silence it is. Hand-mapped here for the same reason as
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
  /** Each declared channel with how many values were considered and emitted. */
  "system.channels": ChannelEmissionReport;
}

/**
 * The SDK's own Topic map: the generated entries plus the engine-owned tail
 * (`system.uplinks`, `system.uplink.pending`). Deliberately distinct from the
 * public, augmentable `TopicPayloadMap` below: bare-primitive Uplink Topics
 * augment `TopicPayloadMap` (not this), so this interface stays fixed to
 * exactly what the SDK owns in every program: augmented or not. The
 * compile-time invariants below bind `TOPIC_IDS` to this map (not the
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
 * {@link TopicPayload} are read from it. Useful for an Uplink that adds Topics
 * of its own, so reads of them are typed. Used by {@link useTelemetry} to type
 * the reading it returns.
 *
 * An Uplink whose Topics are not in the Gonogo contract adds them by
 * augmenting this interface from its client package, and registers each id
 * at load with {@link registerUplinkTopic}:
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
 * Every Topic the mod declares, as a string-literal union, plus those an Uplink
 * adds to {@link TopicPayloadMap}. Useful for catching a misspelt Topic id when
 * a widget lists its channels or reads a Topic. Used by {@link useTelemetry} to
 * type its argument.
 *
 * @category Reading telemetry
 */
export type TopicId = keyof TopicPayloadMap;

/**
 * The payload carried by the readings of Topic `Topic`. Useful for typing a
 * value taken from one Topic. Used by {@link useTelemetry} to type the payload
 * of the reading it returns.
 *
 * @category Reading telemetry
 */
export type TopicPayload<Topic extends TopicId> = TopicPayloadMap[Topic];

/**
 * A Topic is one named stream of values from the mod, such as `vessel.orbit`,
 * read by its id with {@link useTelemetry}. `TOPIC_IDS` is the array of every
 * Topic id the SDK itself declares, and {@link TopicPayloadMap} maps each id to
 * the type of its payload. Useful for listing the Topics the operator can
 * choose from without any Uplink loaded.
 *
 * Topics an Uplink adds at load are not in `TOPIC_IDS`;
 * {@link getAllKnownTopicIds} and {@link isTopicId} include them. Topics whose
 * id is built at runtime, such as one per celestial body,
 * `vessel.partActions.<flightId>` or an Uplink's own `settings.<uplink id>`, are
 * in neither, and are read with {@link useStream}. Nor are the derived channels
 * in {@link DERIVED_CHANNEL_IDS}, such as `system.uplinkHealth`, which the app
 * works out from Topics, or the binary Topic `commcast.radio`, which carries
 * audio rather than a typed payload.
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
 * boolean and so have no named C# payload type for the codegen to reflect. Each
 * is owned by a single Uplink rather than the shared SDK, and each owning
 * Uplink's client package calls `registerUplinkTopic` at module load
 * (mirrors the `registerComponent` self-registration idiom), so the SDK can
 * narrow/enumerate them without ever naming the mod token in this file. See the
 * file header's "Bare-primitive Uplink Topics" note.
 */
const barePrimitiveTopicIds = new Set<string>();

/**
 * Registers a Topic id that an Uplink adds and the SDK does not declare, so
 * {@link isTopicId} and {@link getAllKnownTopicIds} include it. Call it when
 * the Uplink's client package loads, beside its `declare module` entry in
 * {@link TopicPayloadMap}. Registering an id twice does nothing.
 *
 * Register every Topic your Uplink adds through this function, whatever its
 * payload: the name is narrower than what it accepts, which is a Topic of any
 * payload shape and not only one whose payload is a bare boolean or number. A
 * Topic with numeric fields also needs {@link registerTopicUnits}.
 *
 * @category Reading telemetry
 */
export function registerUplinkTopic(id: string): void {
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
 * one an Uplink has registered with {@link registerUplinkTopic}. Useful for
 * checking an id that arrives as text, such as one read from saved layout
 * configuration, before treating it as a Topic.
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
 * {@link registerCollectionTopic}. Useful for knowing that a field path under
 * the Topic can never carry a value. Used by the field picker's catalogue of
 * Topic fields.
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
 * exactly as it does a Topic, but it is not a {@link TopicId}. Useful for
 * listing the channels the operator can read that no Uplink publishes.
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
 * Returns whether `value` is a {@link DerivedChannelId}. Useful for telling a
 * channel the app computes in the browser from one the mod publishes.
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
 * field. Useful for catching a misspelt channel in a widget's declaration.
 *
 * @category Reading telemetry
 */
export type WidgetChannelId = TopicId | DerivedChannelId;

/**
 * Returns whether `value` is a {@link WidgetChannelId}. Useful for checking a
 * channel id that arrives as text before a widget mounts on it.
 *
 * @category Reading telemetry
 */
export function isWidgetChannelId(value: string): value is WidgetChannelId {
  return isTopicId(value) || isDerivedChannelId(value);
}

/**
 * A family of Topics whose id is built at runtime, written the way the docs
 * write it: `vessel.partActions.<flightId>`, `fleet.<vessel>.contact`,
 * `<domain>.available`. Each `<name>` stands for exactly one dotted segment and
 * must fill a whole segment. A widget lists them in `channelFamilies` and
 * `optionalChannelFamilies`.
 *
 * @category Reading telemetry
 */
export type ChannelFamily = `${string}<${string}>${string}`;

/**
 * The literal text before the first placeholder of a family, such as
 * `"fleet."` for `fleet.<vessel>.contact`. It is empty when the pattern starts
 * with a placeholder, as `<domain>.available` does. Useful for narrowing which
 * Topics could belong to a family before matching each one. Used when working out
 * which Topics a widget's declared families cover.
 *
 * @category Reading telemetry
 */
export function familyPrefix(family: ChannelFamily): string {
  return family.slice(0, family.indexOf("<"));
}

/**
 * Returns whether `topic` is a member of `family`: the same number of dotted
 * segments, every literal segment equal and every placeholder segment
 * non-empty. Useful for deciding whether a Topic built at runtime, such as one
 * vessel's contact, belongs to a family a widget declares. Used by the widget
 * Topic declarations check and the alarm status bridge.
 *
 * @category Reading telemetry
 */
export function topicMatchesFamily(
  topic: string,
  family: ChannelFamily,
): boolean {
  const have = topic.split(".");
  const want = family.split(".");
  if (have.length !== want.length) return false;
  return want.every((segment, index) => {
    const isPlaceholder = segment.startsWith("<") && segment.endsWith(">");
    return isPlaceholder ? have[index] !== "" : have[index] === segment;
  });
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
