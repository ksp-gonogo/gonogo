import type { TopicId, TopicPayload } from "../index";
import type { Reading } from "./client-reading";

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

/**
 * Declare the CONTRACT of a Processor without declaring the processor: its
 * owner-stamped id and its result type, published from here, for an
 * implementation that registers somewhere else.
 *
 * ## The problem it solves, and the one it does not
 *
 * An Uplink consumes a Processor by handle, because `useProcessor` reads `R`
 * off the handle's phantom brand. Handing it a bare `{ id }` gets `unknown`,
 * and `getProcessor(id)` is no better: an `AnyProcessorDefinition`'s result is
 * `unknown` by construction, so there is no route from an id back to a type.
 *
 * That is fine for a processor the SDK declares (`CELESTIAL_FACTS` and
 * `DELTA_V_BUDGET` both ship their handle and their result type from the root
 * barrel, and an Uplink test proves an Uplink can consume them). It is NOT fine
 * for one an Uplink declares, and no registry keyed by id can fix that: a
 * declaration merge is scoped to a TypeScript PROGRAM, and Uplink B's program
 * can never include Uplink A's declaration file, because A is unpublished and B
 * cannot depend on it. `TopicPayloadMap` has exactly the same limit for exactly
 * the same reason, and one Uplink cannot type another's Topic either.
 *
 * So the only place a declaration can sit that two Uplinks both compile against
 * is this package, and this is the shape that makes that a route rather than a
 * dead end: the CONTRACT here, the IMPLEMENTATION in whichever Uplink owns the
 * mod it derives from.
 *
 * ```ts
 * // in the SDK, next to the result type it names
 * export interface HabSummary { ... }
 * export const HAB_SUMMARY = defineProcessorContract<HabSummary>("<owner>:hab-summary");
 *
 * // in the owning Uplink, which imports the type it must satisfy
 * OWNER.registerProcessor({ id: "hab-summary", deps, compute });
 *
 * // in any OTHER Uplink, which imports neither that Uplink nor its types
 * const hab = useProcessor(HAB_SUMMARY);   // HabSummary | undefined
 * ```
 *
 * ## Absence is a value, not a crash
 *
 * A contract whose implementation never registers (the mod is not installed,
 * the Uplink did not load) evaluates to nothing and `useProcessor` answers
 * `undefined`, which every consumer already has to handle because that is also
 * what it answers before the first frame. That is deliberately the same
 * graceful-degradation shape a domain-gated widget already has, and it is why
 * this does not need a presence check bolted on.
 *
 * ## What it cannot check
 *
 * That the registered `compute` returns what the contract promises. The two
 * sides are in different packages and the brand is type-only, so the guarantee
 * comes from the implementing Uplink importing `R` from here and annotating its
 * `compute` with it. Declaring the type twice, once each side, is the failure
 * this exists to prevent, so do not.
 */
export function defineProcessorContract<R>(id: string): ProcessorHandle<R> {
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
