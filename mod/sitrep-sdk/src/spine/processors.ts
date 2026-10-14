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
 * {@link defineProcessorContract} returns it. Useful for reading a computed value
 * shared by several widgets. Pass it to {@link useProcessor}, or list it in a
 * contribution's `deps`. Its type carries the processor's result type.
 *
 * @typeParam Result - The type of the value the processor's `compute` returns.
 * @typeParam ProcessorId - The literal type of its id, `"<uplink id>:<name>"`.
 * @typeParam Carried - Whether the processor returns a `Reading` rather than a
 * bare value. It does when any of its dependencies is a reading: the result is
 * then a {@link Reading} whose `state` says how current it is, dated by those
 * inputs. See {@link useProcessor}.
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
 * `true` when a dep list contains a {@link ReadingDep}, so the processor's
 * result is a `Reading` that says how current it is, and `false` when every dep
 * is a bare Topic or another processor. Useful for typing a processor's result
 * as a `Reading` when any dependency is one. Used by
 * {@link UplinkClientHandle.registerProcessor} to type the handle it returns.
 *
 * @category Processors
 */
export type CarriesCurrency<Deps extends readonly Dep[]> =
  /*
   * Wrapped in a tuple so a union of deps does not distribute: the answer is a
   * property of the list as a whole, and a distributed `extends never` would
   * decide it once per member.
   */
  [Extract<Deps[number], ReadingDep>] extends [never] ? false : true;

/**
 * A dep asking for a Topic's `Reading` rather than its bare payload. Useful for
 * letting a processor's result say how current it is: a processor given only the
 * payload computes on last-contact values during a blackout and presents the
 * result as if it were now. Listed in a processor's `deps`.
 *
 * `{ reading: "vessel.resources" }` resolves to the Topic's {@link TopicReading}
 * in the processor's `compute`. A processor with a reading among its deps returns
 * a {@link Reading} of its own, whose `state` follows from those inputs (see
 * {@link CarriesCurrency}). Return a plain value, not the reading, when the result
 * combines several Topics: it is no single Topic's currency.
 *
 * @typeParam Topic - The Topic read.
 *
 * @category Processors
 */
export interface ReadingDep<Topic extends TopicId = TopicId> {
  /** The Topic whose reading the processor is given. */
  readonly reading: Topic;
}

/**
 * A dep whose Topic is only known once the fixed deps have resolved: "the orbit
 * of whichever vessel this route names", not a Topic id anyone can write down in
 * advance. Useful for carrying forward a reading about a vessel the operator
 * selects at run time. Declared by the reckoners built into the SDK. Only a
 * reckoner declares one; a processor handed one is refused.
 *
 * `Payload` is the payload the resolved Topic carries, which you state, since a
 * Topic id computed at runtime has no entry in `TopicPayloadMap` to infer from.
 * When `subject` returns `undefined` the dep resolves to `undefined` and the
 * model declines for the missing input, the same as any other absent Topic.
 *
 * @typeParam Payload - The payload the resolved Topic carries.
 * @typeParam Fixed - The leading deps `subject` reads, so it destructures typed.
 *
 * @category Reckoners
 */
export interface SubjectDep<
  Payload = unknown,
  Fixed extends readonly unknown[] = readonly unknown[],
> {
  /** The topic to read, given the subject id: `` (id) => `trackingStation.vessel.${id}.resources` ``. */
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
   * `unknown-cast` exists to stop. Declared as a method rather than a property
   * so the bivariance lets a selector over a narrow tuple still satisfy the
   * `SubjectDep<unknown>` the `Dep` union carries.
   */
  subject(point: TimelinePoint<unknown>, resolved: Fixed): string | undefined;
  /** Phantom: the payload the resolved topic carries. Never read at runtime. */
  readonly __payloadType?: Payload;
}

/**
 * A processor dependency: a raw Topic id, a Topic's reading, another processor's
 * handle, or a per-subject topic resolved at reckon time. Useful for declaring
 * what a processor or reckoner computes from. Listed in the `deps` of a
 * processor, a reckoner and a contribution.
 *
 * The last, a {@link SubjectDep}, is for a reckoner to declare. A processor that
 * declares one throws an error when it first runs: a processor has no point to
 * take a subject from, and resolving it to `undefined` there would be
 * indistinguishable from an absent input.
 *
 * @category Processors
 */
export type Dep =
  | TopicId
  | ReadingDep
  | ProcessorHandle<unknown>
  | SubjectDep<unknown>;

/**
 * Whether this dep's topic is computed per subject rather than declared. Useful
 * for telling a reckoner's dependency apart from a fixed one. Used by the
 * processor evaluator and the timeline store.
 */
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

/**
 * The tuple of resolved dependency values a processor's `compute` receives, in
 * the order of its deps. Useful for typing a `compute` function from its dep
 * list. Used by {@link UplinkClientHandle.registerProcessor}.
 *
 * @category Processors
 */
export type ResolvedDeps<Deps extends readonly Dep[]> = {
  [Index in keyof Deps]: Deps[Index] extends Dep
    ? ResolvedDep<Deps[Index]>
    : never;
};

/**
 * What a processor's `compute` is told about the frame it is running for, beyond
 * its deps. A frame is one pass of the app's telemetry store: it publishes a
 * batch of new samples, and every processor runs once against it. Useful for
 * turning an instant on the wire into a remaining duration the operator reads.
 * Passed to `compute` by {@link UplinkClientHandle.registerProcessor}.
 *
 * It holds only the frame's view time, the game time the screen is showing. Use
 * it, not the wall clock, so a replay of the same samples gives the same result.
 *
 * @category Processors
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
 * Declares a Processor and returns an opaque handle other processors and
 * contributions depend on. Useful for computing a value once and sharing it
 * across widgets. Registers under the owner-stamped id `${owner}:${id}` (the
 * same owner-stamp convention as registerContribution). Re-registering the exact
 * same definition (same compute reference) is a no-op so a module can be
 * imported twice; a different definition under an already-used id throws.
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
 * Returns a handle to a processor that another Uplink implements, so any Uplink
 * can read it with {@link useProcessor} without depending on the one that
 * implements it. Export the handle and its result type from a module both
 * Uplinks import: a small shared package of your own for two of your Uplinks,
 * as the SDK does for the ones it ships. The implementing Uplink registers a
 * processor under the same id and types its `compute` with the same result
 * type. Useful for showing the operator data that one Uplink computes inside
 * another Uplink's widget, without the second depending on the first.
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
