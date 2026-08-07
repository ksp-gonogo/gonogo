import type { TopicId, TopicPayload } from "@ksp-gonogo/sitrep-sdk";

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

/** A processor dependency: either a raw Topic id or another processor's handle. */
export type Dep = TopicId | ProcessorHandle<unknown>;

/**
 * The resolved value for one dependency: a nested processor resolves to its
 * result type R; a Topic id resolves to its payload (or undefined when that
 * Topic has produced no frame yet).
 */
type ResolvedDep<D extends Dep> =
  D extends ProcessorHandle<infer R>
    ? R
    : D extends TopicId
      ? TopicPayload<D> | undefined
      : never;

/** Positionally-mapped tuple of resolved dependency values, in deps order. */
export type ResolvedDeps<Deps extends readonly Dep[]> = {
  [K in keyof Deps]: Deps[K] extends Dep ? ResolvedDep<Deps[K]> : never;
};

export interface ProcessorDefinition<
  Deps extends readonly Dep[] = readonly Dep[],
  R = unknown,
> {
  id: string;
  owner: string;
  deps: Deps;
  compute: (values: ResolvedDeps<Deps>) => R;
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
  compute: (values: ResolvedDeps<Deps>) => R;
}): ProcessorHandle<R> {
  const stampedId = `${def.owner}:${def.id}`;
  const existing = processors.get(stampedId);
  const stamped: AnyProcessorDefinition = {
    id: stampedId,
    owner: def.owner,
    deps: def.deps,
    compute: def.compute as (values: ResolvedDeps<readonly Dep[]>) => unknown,
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
