import { getHost, hasHost } from "../api/host";
import type {
  AnyContribution,
  ContributionDefinition,
  NamespacedAugmentSettings,
} from "../api/types";

/**
 * The contribution REGISTRATION seam (contribution-slots-spec.md §3-4, §14): the
 * live registry `registerContribution` writes and the per-frame aggregation
 * reads.
 *
 * It was in `@ksp-gonogo/core`, which is `private: true`, so an Uplink could
 * register a contribution through the published shim and then had no supported
 * way to read back or reset what it had registered. Seven Uplink test files call
 * `clearContributions`.
 *
 * Everything it named was already on this side of the line once
 * `ContributionTopics`, `Contributed` and `UplinkClientIdentity` came down from
 * `@ksp-gonogo/ui-kit`: the definition type, the settings shape and the logger are
 * all sdk-side. The READ half (the per-widget store and the `useContributions`
 * hooks) stays in ui-kit, which reaches this through the ordinary
 * ui-kit-imports-sdk direction.
 */

/**
 * One global slot rather than module statics, keyed by a string so two different
 * builds of this package still find the same registry. A second copy of THIS one
 * is a contribution registering into a Map the aggregation never reads, with no
 * error anywhere, which is the failure mode the shim design existed to prevent.
 * Same reasoning as `api/action-dispatch.ts`.
 */
const CONTRIBUTIONS_KEY = "__GONOGO_CONTRIBUTIONS__" as const;

interface ContributionRegistryState {
  entries: Map<string, { def: AnyContribution; order: number }>;
  listeners: Set<() => void>;
  counter: number;
}

function state(): ContributionRegistryState {
  const slot = globalThis as typeof globalThis & {
    [CONTRIBUTIONS_KEY]?: ContributionRegistryState;
  };
  slot[CONTRIBUTIONS_KEY] ??= {
    entries: new Map(),
    listeners: new Set(),
    counter: 0,
  };
  return slot[CONTRIBUTIONS_KEY];
}

function notifyContributionChange(): void {
  for (const cb of state().listeners) cb();
}

export function onContributionsChange(cb: () => void): () => void {
  const listeners = state().listeners;
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
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
  const s = state();
  const existing = s.entries.get(def.id);
  if (existing !== undefined) {
    // Widened through `unknown` because `compute` puts `S` in a PARAMETER
    // position (`ContributionTopics<S>`), so `ContributionDefinition<S>` and
    // `ContributionDefinition<string>` are not mutually assignable however
    // narrow `S` is. The registry genuinely stores defs for many slots at once,
    // so erasing `S` on the way in is the honest thing; every read hands the
    // entries back to the aggregation, which re-narrows per slot.
    if (existing.def === (def as unknown as AnyContribution)) return;
    throw new Error(
      `Contribution id "${def.id}" is already registered for slot "${existing.def.contributes}"; ` +
        `cannot re-register for "${def.contributes}". Contribution ids must be globally unique ` +
        `(use defineUplinkClient(...).registerContribution to auto-namespace by owner).`,
    );
  }
  // Guarded, and straight from `./host` rather than `../api/logger`'s Proxy, for
  // the same two reasons `api/registry.ts` does it: the Proxy would be a cycle
  // (the barrel re-exports this module's callers), and an UNGUARDED read throws
  // when no host is installed. Self-registration runs at module load, before any
  // host exists: `packages/ui/src/FilterList.test.tsx` registers a contribution at
  // import time and died on exactly this. A registration must not depend on the
  // host merely because it logs.
  if (hasHost())
    getHost().logger.info(
      `REGISTERED contribution ${def.id} -> ${def.contributes}`,
    );
  s.entries.set(def.id, {
    def: def as unknown as AnyContribution,
    order: s.counter++,
  });
  notifyContributionChange();
}

export function getContributionsForSlot(slot: string): AnyContribution[] {
  return Array.from(state().entries.values())
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
  const s = state();
  s.entries.clear();
  s.counter = 0;
  notifyContributionChange();
}
