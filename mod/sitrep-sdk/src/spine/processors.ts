import type { TopicId, TopicPayload } from "../index";
import type { Reading } from "./client-reading";

// ---------------------------------------------------------------------------
// The Processor primitive (contribution-slots-spec.md 13.3, 14): a declared
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
 * Opaque, branded handle returned by defineProcessor. Never constructed by
 * hand: carries the result type R through inference for downstream consumers.
 */
export interface ProcessorHandle<R> {
  readonly id: string;
  /** Type-only brand: never present at runtime, carries R through inference. */
  readonly __resultType?: R;
}

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
 * `sampleReading` re-derives a `reckonable` arm whenever the frame's view time
 * moves. Both are keyed on the same thing, the frame, so a processor sees a
 * reading built for the moment it is deriving for without any new invalidation
 * machinery.
 *
 * ## What a processor should NOT do with it
 *
 * Return it. A `Reading` is one Topic's currency; a cross-resource conclusion
 * ("four hours of oxygen, but not if the batteries go first") is not one
 * Topic's anything. A processor whose output is modelled carries its own
 * provenance instead, the way a projection channel's payload does with
 * `observed` / `projected` / `lower` / `upper` / `elapsed`.
 */
export interface ReadingDep<T extends TopicId = TopicId> {
  readonly reading: T;
}

/** A processor dependency: a raw Topic id, a Topic's reading, or another processor's handle. */
export type Dep = TopicId | ReadingDep | ProcessorHandle<unknown>;

/**
 * The resolved value for one dependency: a nested processor resolves to its
 * result type R; a reading dep resolves to the Topic's `Reading`; a Topic id
 * resolves to its payload (or undefined when that Topic has produced no frame
 * yet).
 */
type ResolvedDep<D extends Dep> =
  D extends ProcessorHandle<infer R>
    ? R
    : D extends ReadingDep<infer T>
      ? Reading<TopicPayload<T>>
      : D extends TopicId
        ? TopicPayload<D> | undefined
        : never;

/** Positionally-mapped tuple of resolved dependency values, in deps order. */
export type ResolvedDeps<Deps extends readonly Dep[]> = {
  [K in keyof Deps]: Deps[K] extends Dep ? ResolvedDep<Deps[K]> : never;
};

/**
 * What a `compute` is told about the frame it is running for, beyond its deps.
 *
 * Only the view time, and deliberately only that: a processor that needs to
 * know WHEN it is deriving for is common (anything turning an instant on the
 * wire into a remaining duration), and a processor that reaches for a wall
 * clock instead is the bug `readingAge` and the wall-clock ratchet exist to
 * stop. Handing it the frame's own frozen view time means there is nothing to
 * reach for.
 */
export interface ProcessorFrame {
  /** The frame's frozen view time. Every read in this frame shares it. */
  viewUt: number;
}

export interface ProcessorDefinition<
  Deps extends readonly Dep[] = readonly Dep[],
  R = unknown,
> {
  id: string;
  owner: string;
  deps: Deps;
  compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
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
export function defineProcessor<const Deps extends readonly Dep[], R>(def: {
  id: string;
  owner: string;
  deps: Deps;
  compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
}): ProcessorHandle<R> {
  const stampedId = `${def.owner}:${def.id}`;
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
