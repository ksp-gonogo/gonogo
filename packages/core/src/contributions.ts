import { logger } from "@ksp-gonogo/logger";
import type { Dep } from "@ksp-gonogo/sitrep-client";
import type { ContributionEntry, ContributionTopics } from "@ksp-gonogo/ui-kit";
import type {
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "./augments";
import type { UplinkClientHandle } from "./uplinkClients";

// ---------------------------------------------------------------------------
// The contribution REGISTRATION seam (contribution-slots-spec.md §3-4, §14).
// The TYPE surface (`ContributionRegistry`, `ContributionEntry`, `Contributed`,
// the segment machinery, ...) moved to `@ksp-gonogo/ui-kit` so the read hooks
// and `FilterList` are reachable without core; it is re-exported below so every
// `@ksp-gonogo/core` importer and `declare module "@ksp-gonogo/core"`
// augmentation is unchanged. The write path stays here: `ContributionDefinition`
// carries sitrep-client `Dep[]` deps (a spine type) and `registerContribution`
// drives the live registry the core-side aggregation reads.
// ---------------------------------------------------------------------------

// Re-export the type surface that moved to the design floor, so
// `@ksp-gonogo/core` continues to export it and augmentations still merge.
export type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  Contributed,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
  ContributionTopics,
  UplinkClientIdentity,
} from "@ksp-gonogo/ui-kit";

export interface ContributionDefinition<S extends string = string> {
  /** Stable id, unique GLOBALLY (same flat namespace as augment ids). */
  id: string;
  /** The slot this contribution feeds. */
  contributes: S;
  /**
   * This contribution's own deps: Topics and/or Processors, statically
   * declared (contribution-slots-spec §14: shared `deps` field with Processor).
   * A ProcessorHandle dep resolves to that processor's frame-memoised value
   * (read by its stamped id); a TopicId dep resolves as it always has.
   */
  deps?: readonly Dep[];
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
