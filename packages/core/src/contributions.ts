import { logger } from "@ksp-gonogo/logger";
import type { TopicId, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import type {
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "./augments";
import type { UplinkClientHandle } from "./uplinkClients";

// ---------------------------------------------------------------------------
// The contribution model (contribution-slots-spec.md §3-4): a pure-data
// sibling of the augment model. An augment contributes a component and owns
// its rendering; a contribution contributes typed DATA and the host renders
// it with the host's own chrome. Same declaration-merge seam as SlotRegistry
// (augments.ts), same requires/priority/settings shape, different payload.
// ---------------------------------------------------------------------------

/**
 * Global slot -> {ctx, entry, topics} registry, extended via declaration
 * merging exactly like SlotRegistry (augments.ts). `topics` is the union of
 * Topic ids a contribution bound to this slot may read; omit it for a slot
 * that needs no topics.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam, mirrors SlotRegistry
export interface ContributionRegistry {}

/** Union of every declared in-tree contribution slot id. `never` until a package merges one in. */
export type ContributionSlotId = keyof ContributionRegistry;

/** The entry shape a slot renders. Falls back to a loose record for an out-of-repo slot id. */
export type ContributionEntry<S extends string> =
  S extends keyof ContributionRegistry
    ? ContributionRegistry[S] extends { entry: infer E }
      ? E
      : Record<string, unknown>
    : Record<string, unknown>;

type DeclaredTopicUnion<S extends string> = S extends keyof ContributionRegistry
  ? ContributionRegistry[S] extends { topics: infer T extends string }
    ? T
    : never
  : never;

/** The typed argument a slot's contributions receive: current values of every declared topic. */
export type ContributionTopics<S extends string> = {
  readonly [K in DeclaredTopicUnion<S> & TopicId]: TopicPayload<K> | undefined;
};

/** One rendered entry, tagged with provenance for keys and blame. */
export type Contributed<E> = E & {
  readonly contributionId: string;
  readonly owner?: UplinkClientHandle;
};

export interface ContributionDefinition<S extends string = string> {
  /** Stable id, unique GLOBALLY (same flat namespace as augment ids). */
  id: string;
  /** The slot this contribution feeds. */
  contributes: S;
  /**
   * This contribution's own Topics, statically declared (contribution-slots-
   * spec §14: shared `deps` field with Processor; Phase 1 accepts Topics
   * only, widened to accept ProcessorHandle deps once Processor lands).
   */
  deps?: readonly TopicId[];
  /**
   * Pure. Receives the current values of `deps`, typed. Returns entries to
   * render, or null/undefined for "nothing now". MUST be referentially
   * stable when inputs are unchanged; the host's aggregation store applies a
   * shallow-equal guard as a backstop, not a substitute.
   */
  compute: (
    topics: ContributionTopics<S>,
  ) => readonly ContributionEntry<S>[] | null | undefined;
  /** Domain presence gate, identical semantics to AugmentDefinition.requires. */
  requires?: string;
  /** Ascending, ties in registration order. Same as augments.ts. */
  priority?: number;
  settings?: readonly AugmentSettingField[];
  /** Stamped by `defineUplinkClient(...).registerContribution`, never set by hand. */
  owner?: UplinkClientHandle;
}

export type AnyContribution = ContributionDefinition<string>;

const contributions = new Map<
  string,
  { def: AnyContribution; order: number }
>();
let registrationCounter = 0;

const contributionListeners = new Set<() => void>();
function notifyContributionChange(): void {
  for (const cb of contributionListeners) cb();
}

export function onContributionsChange(cb: () => void): () => void {
  contributionListeners.add(cb);
  return () => {
    contributionListeners.delete(cb);
  };
}

/**
 * Register a contribution (contribution-slots-spec §14): id collision throws
 * synchronously AT this call site (no accumulate-then-flush frame), unless
 * the exact same def is re-registering (a benign idempotent re-import).
 */
export function registerContribution<S extends string>(
  def: ContributionDefinition<S>,
): void {
  const existing = contributions.get(def.id);
  if (existing !== undefined) {
    if (existing.def === (def as AnyContribution)) return;
    throw new Error(
      `Contribution id "${def.id}" is already registered for slot "${existing.def.contributes}"; ` +
        `cannot re-register for "${def.contributes}". Contribution ids must be globally unique ` +
        `(use defineUplinkClient(...).registerContribution to auto-namespace by owner).`,
    );
  }
  logger.info(`REGISTERED contribution ${def.id} -> ${def.contributes}`);
  contributions.set(def.id, {
    def: def as AnyContribution,
    order: registrationCounter++,
  });
  notifyContributionChange();
}

export function getContributionsForSlot(slot: string): AnyContribution[] {
  return Array.from(contributions.values())
    .filter((entry) => entry.def.contributes === slot)
    .sort((a, b) => {
      const pa = a.def.priority ?? 0;
      const pb = b.def.priority ?? 0;
      if (pa !== pb) return pa - pb;
      return a.order - b.order;
    })
    .map((entry) => entry.def);
}

export function getContributionSettings(
  slot: string,
): NamespacedAugmentSettings[] {
  return getContributionsForSlot(slot)
    .filter((def) => def.settings && def.settings.length > 0)
    .map((def) => ({
      augmentId: def.id,
      namespace: def.id,
      fields: def.settings ?? [],
    }));
}

/** For use in tests only, resets the contribution registry to empty. */
export function clearContributions(): void {
  contributions.clear();
  registrationCounter = 0;
  notifyContributionChange();
}
