import type { TopicId, TopicPayload } from "../index";
import type { Reading } from "../reading";
import type { TimelinePoint } from "../timeline";
import type { TopicReading } from "./client-reading";

// ---------------------------------------------------------------------------
// The Processor primitive: a declared
// pure function of Topics (and other Processors), exposed two ways: called
// directly by a Contribution (pure), and consumed via useProcessor (Task 3.3)
// by an augment. One source, two forms, evaluated ONCE per Sitrep frame no
// matter how many consumers pull from it (Task 3.2's frame-batched evaluator).
//
// Lives in @ksp-gonogo/sitrep-client (the spine), not core: the evaluator and
// useProcessor need TimelineStore.subscribeFrame/currentFrame/sample, and core
// already depends on sitrep-client (not the reverse), so a registry in core
// called from the spine would cycle. See this plan's Phase 3 header.
// ---------------------------------------------------------------------------

/**
 * A handle to a processor, as {@link UplinkClientHandle.registerProcessor} or
 * {@link defineProcessorContract} returns it. Pass it to {@link useProcessor},
 * or list it in a contribution's `deps`. Its type carries the processor's
 * result type.
 *
 * @typeParam Result - What the processor computes.
 * @typeParam ProcessorId - Its id.
 * @typeParam Carried - Whether it returns a `Reading` (see {@link useProcessor}).
 *
 * @category Processors
 */
export interface ProcessorHandle<
  Result,
  ProcessorId extends string = string,
  Carried extends boolean = boolean,
> {
  /** The processor's id, `"<uplink id>:<name>"`. A contribution depending on the handle receives its result under this key. */
  readonly id: ProcessorId;
  /** Type-only brand: never present at runtime, carries `Result` through inference. */
  readonly __resultType?: Result;
  /** Type-only, never present at runtime: whether the processor returns a `Reading`, which it does when a reading is among its dependencies. */
  readonly __carriesCurrency?: Carried;
}

/**
 * Whether a dep list makes its processor's result datable.
 *
 * Wrapped in a tuple so a union of deps does not distribute: the question is
 * about the list as a whole, and a distributed `extends never` would decide it
 * once per member.
 */
export type CarriesCurrency<Deps extends readonly Dep[]> = [
  Extract<Deps[number], ReadingDep>,
] extends [never]
  ? false
  : true;

/**
 * A dep asking for a Topic's `Reading` rather than its bare payload.
 *
 * The wrapper exists because a Topic id is a plain string, so there is nothing
 * to distinguish "give me the value" from "give me the value and its currency"
 * without one. `{ reading: "vessel.resources" }` reads at the call site as the
 * request it is.
 *
 * ## Why a processor needs this at all
 *
 * A processor resolved a Topic dep to `point.payload`: the VALUE channel alone,
 * with no staleness, no `validAt` and no model. So a derivation that reasons
 * ACROSS topics could not tell whether its inputs were current, and during a
 * blackout it computed on last-contact values and its consumers presented the
 * result as though it were now. `ShipSystems` does exactly that today: a
 * time-to-empty derived from levels observed twenty minutes ago, rendered with
 * nothing anywhere saying so. That is the failure this whole type exists to
 * prevent, in the widget where it matters most.
 *
 * ## Why it composes
 *
 * `evaluate` skips a processor whose `lastFrameGeneration` matches the frame,
 * so it is memoised WITHIN a frame and re-evaluated ACROSS frames.
 * `sampleReading` re-derives a reading carrying a model whenever the frame's
 * view time moves. Both are keyed on the same thing, the frame, so a processor
 * sees a reading built for the moment it is deriving for without any new
 * invalidation machinery.
 *
 * ## What a processor should NOT do with it
 *
 * Return it. A `Reading` is one Topic's currency; a cross-resource conclusion
 * ("four hours of oxygen, but not if the batteries go first") is not one
 * Topic's anything. A processor whose output is modelled carries its own
 * provenance instead, the way a projection channel's payload does with
 * `observed` / `projected` / `lower` / `upper` / `elapsed`.
 */
export interface ReadingDep<Topic extends TopicId = TopicId> {
  readonly reading: Topic;
}

/**
 * A dep whose topic is only known once the FIXED deps have resolved: "the orbit
 * of whichever vessel this route names", not a topic id anyone can write down.
 *
 * ## Why a fixed list cannot express it
 *
 * `comms.delay`'s model refuses a relayed route outright, and its own decline
 * says why: the route home starts at a relay, and where that relay is now sits
 * on `fleet.<guid>.orbit`, whose guid arrives IN the route. The model has the
 * guid in hand at reckon time; what it has no way to say is "subscribe that".
 * Every other dep variety names its topic at declaration time, which is exactly
 * the thing a subject cannot do.
 *
 * ## The payload type is stated, not looked up
 *
 * `Payload` is the payload the resolved topic carries, and the author gives it,
 * the same way `useStream<WireOf<VesselOrbitPayload>>(`fleet.${guid}.orbit`)`
 * already does at every other dynamic read in the tree. A dynamic topic has no
 * member in `TopicPayloadMap` to infer from: the ids are computed at runtime,
 * which is the same reason `dynamicWholeTopicPrefixes` exists rather than a
 * generated list.
 *
 * ## An undeclared subject declines, it does not guess
 *
 * `subject` returning `undefined` resolves the dep to `undefined`, which the
 * store already turns into the `input-absent` decline every other unmet dep
 * gets. A model that cannot name its subject has not got its input, and saying
 * so is the same result as an absent channel rather than a new one.
 */
export interface SubjectDep<
  Payload = unknown,
  Fixed extends readonly unknown[] = readonly unknown[],
> {
  /** The topic to read, given the subject id: `` (id) => `fleet.${id}.orbit` ``. */
  forSubject(subjectId: string): string;
  /**
   * Which subject this reckon is about, read from the point and the fixed deps
   * resolved beside it. `undefined` means this reckon has no subject, which is
   * not the same as a missing input: the dep resolves to `undefined` and the
   * model decides.
   *
   * `Fixed` is the prefix of the model's own deps this selector reads, declared
   * so it destructures typed. Without it `resolved` is `readonly unknown[]` and
   * every selector opens with an assertion out of `unknown`, which is the thing
   * `unknown-cast` exists to stop. Declared as a METHOD rather than a property
   * so the bivariance lets a selector over a narrow tuple still satisfy the
   * `SubjectDep<unknown>` the `Dep` union carries.
   */
  subject(point: TimelinePoint<unknown>, resolved: Fixed): string | undefined;
  /** Phantom: the payload the resolved topic carries. Never read at runtime. */
  readonly __payloadType?: Payload;
}

/**
 * A processor dependency: a raw Topic id, a Topic's reading, another
 * processor's handle, or a per-subject topic resolved at reckon time.
 *
 * The last is a RECKONER's to declare. It is in this union rather than in a
 * second one because a reckoner's inputs are the same kind of thing a
 * processor's are, and the alternative is two vocabularies to keep in step (see
 * `ResolvedReckonerDep`, which says the same about resolution). A processor
 * handed one is refused out loud by the evaluator: a processor has no point to
 * take a subject from, and resolving it to `undefined` there would be
 * indistinguishable from an absent input.
 */
export type Dep =
  | TopicId
  | ReadingDep
  | ProcessorHandle<unknown>
  | SubjectDep<unknown>;

/** Whether this dep's topic is computed per subject rather than declared. */
export function isSubjectDep(dep: Dep): dep is SubjectDep<unknown> {
  return typeof dep === "object" && dep !== null && "forSubject" in dep;
}

/**
 * The resolved value for one dependency: a nested processor resolves to its
 * result type R; a reading dep resolves to the Topic's `Reading`; a Topic id
 * resolves to its payload (or undefined when that Topic has produced no frame
 * yet).
 */
type ResolvedDep<Dependency extends Dep> =
  Dependency extends ProcessorHandle<infer Result, string, true>
    ? Reading<Result>
    : Dependency extends ProcessorHandle<infer Result>
      ? Result
      : Dependency extends ReadingDep<infer Topic>
        ? TopicReading<TopicPayload<Topic>>
        : Dependency extends TopicId
          ? TopicPayload<Dependency> | undefined
          : never;

/** Positionally-mapped tuple of resolved dependency values, in deps order. */
export type ResolvedDeps<Deps extends readonly Dep[]> = {
  [Index in keyof Deps]: Deps[Index] extends Dep
    ? ResolvedDep<Deps[Index]>
    : never;
};

/**
 * What a `compute` is told about the frame it is running for, beyond its deps.
 *
 * Only the frame's view time, and deliberately only that: a processor that
 * needs to know WHEN it is deriving for is common (anything turning an instant
 * on the wire into a remaining duration), and a processor that reaches for a
 * wall clock instead is the bug `readingAge` and the wall-clock ratchet exist
 * to stop. Handing it the frame's own frozen view time means there is nothing to
 * reach for.
 */
export interface ProcessorFrame {
  /** The frame's frozen view time. Every read in this frame shares it. */
  viewUt: number;
}

export interface ProcessorDefinition<
  Deps extends readonly Dep[] = readonly Dep[],
  Result = unknown,
> {
  id: string;
  owner: string;
  deps: Deps;
  compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => Result;
}

export type AnyProcessorDefinition = ProcessorDefinition<
  readonly Dep[],
  unknown
>;

const processors = new Map<string, AnyProcessorDefinition>();

/**
 * Declare a Processor. Registers under the owner-stamped id `${owner}:${id}`
 * (same owner-stamp convention as registerContribution) and returns an opaque
 * handle other processors and contributions depend on. Re-registering the
 * exact same definition (same compute reference) is a no-op so a module can be
 * imported twice; a DIFFERENT definition under an already-used id throws.
 */
export function defineProcessor<
  const Deps extends readonly Dep[],
  Result,
  const ProcessorId extends string,
>(def: {
  id: ProcessorId;
  owner: string;
  deps: Deps;
  compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => Result;
}): ProcessorHandle<Result, `${string}:${ProcessorId}`, CarriesCurrency<Deps>> {
  /* Typed rather than inferred: a template expression widens to `string`, and
     the stamped id is what a contribution keys this processor's result by, so
     the shape has to survive as far as the handle. */
  const stampedId: `${string}:${ProcessorId}` = `${def.owner}:${def.id}`;
  const existing = processors.get(stampedId);
  const stamped: AnyProcessorDefinition = {
    id: stampedId,
    owner: def.owner,
    deps: def.deps,
    compute: def.compute as (
      values: ResolvedDeps<readonly Dep[]>,
      frame: ProcessorFrame,
    ) => unknown,
  };
  if (existing !== undefined) {
    if (existing.compute === stamped.compute) return { id: stampedId };
    throw new Error(
      `Processor id "${stampedId}" is already registered; a different ` +
        `definition cannot re-use it. Processor ids must be unique within ` +
        `their owner.`,
    );
  }
  processors.set(stampedId, stamped);
  return { id: stampedId };
}

/**
 * Returns a handle to a processor that another Uplink implements, so any
 * Uplink can read it with {@link useProcessor} without depending on the one
 * that implements it. Export the handle and its result type from a module
 * both Uplinks import: a small shared package of your own for two of your
 * Uplinks, as the SDK does for the ones it ships. The implementing Uplink
 * registers a processor under the same id and types its `compute` with the
 * same result type.
 *
 * When nothing registers the processor, as when its mod is not installed,
 * `useProcessor` returns `undefined`.
 *
 * Throws when `id` is not `"<uplink id>:<name>"`, the implementing Uplink's
 * id and then the processor's own name.
 *
 * @example One Uplink implements a processor, and any other reads it
 * ```ts
 * import {
 *   defineProcessorContract,
 *   defineUplinkClient,
 *   useProcessor,
 * } from "@ksp-gonogo/sitrep-sdk";
 *
 * // In a module both Uplinks import: the result's type and the contract.
 * interface HabSummary {
 *   crewDays: number;
 * }
 * const HAB_SUMMARY = defineProcessorContract<HabSummary>("habitat:summary");
 *
 * // In the Uplink "habitat", which implements it. Its handle puts
 * // "habitat:" in front of the name, so the id is "habitat:summary".
 * const HABITAT = defineUplinkClient({
 *   id: "habitat",
 *   version: "1.0.0",
 *   name: "Habitat",
 *   description: "Life support for a crewed vessel.",
 * });
 * HABITAT.registerProcessor({
 *   id: "summary",
 *   deps: [],
 *   compute: (): HabSummary => ({ crewDays: 12 }),
 * });
 *
 * // In any other Uplink's component. A contract does not say whether the
 * // processor's inputs were readings, so the result is typed as the bare
 * // HabSummary or a Reading of one, and is undefined while nothing implements it.
 * function useHabSummary() {
 *   return useProcessor(HAB_SUMMARY);
 * }
 * ```
 *
 * @category Processors
 */
export function defineProcessorContract<
  Result,
  const ProcessorId extends string = string,
>(id: ProcessorId): ProcessorHandle<Result, ProcessorId> {
  // A contract names an id `registerProcessor` will STAMP, so it has to be
  // written owner-first. Checked here because the alternative is a handle that
  // silently answers `undefined` forever, which is indistinguishable from the
  // mod not being installed: the one case this is supposed to make legible.
  if (id.split(":").length !== 2 || id.startsWith(":") || id.endsWith(":")) {
    throw new Error(
      `Processor contract id "${id}" must be owner-stamped as "<owner>:<id>", ` +
        `matching what registerProcessor stamps for the Uplink that implements it.`,
    );
  }
  return { id };
}

export function getProcessor(id: string): AnyProcessorDefinition | undefined {
  return processors.get(id);
}

export function getAllProcessors(): AnyProcessorDefinition[] {
  return Array.from(processors.values());
}

/** Test-only: reset the processor registry to empty. */
export function clearProcessors(): void {
  processors.clear();
}
