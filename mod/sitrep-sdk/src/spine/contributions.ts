import { getHost, hasHost } from "../api/host";
import type {
  AnyContribution,
  ContributionDefinition,
  ContributionDep,
  NamespacedAugmentSettings,
} from "../api/types";
import { assertSizeDelta } from "./size-delta";
import { warnIfSlotUnknown } from "./slot-ids";

/**
 * The contribution registration seam: the
 * live registry `registerContribution` writes and the per-frame aggregation
 * reads.
 *
 * It was in `@ksp-gonogo/core`, which is `private: true`, so an Uplink could
 * register a contribution through the published shim and then had no supported
 * way to read back or reset what it had registered. Seven Uplink test files call
 * `clearContributions`.
 *
 * Everything it named was already on this side of the line once
 * `Contributed` and `UplinkClientIdentity` came down from
 * `@ksp-gonogo/ui-kit`: the definition type, the settings shape and the logger are
 * all sdk-side. The read half (the per-widget store and the `useContributions`
 * hooks) stays in ui-kit, which reaches this through the ordinary
 * ui-kit-imports-sdk direction.
 */

/**
 * One global slot rather than module statics, keyed by a string so two different
 * builds of this package still find the same registry. A second copy of this one
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
 * Registers a contribution: an entry that a widget shows in one of its slots,
 * such as a badge or a row. Useful for adding to another widget's panel what
 * the operator needs to see for a vessel. Used by the widgets that fill a slot
 * of their own, such as the space centre facilities and the comm signal badge.
 *
 * A slot id that no widget draws warns in development, naming the Uplink and
 * the slots close to it.
 *
 * An id collision throws at this call, unless the identical definition is
 * registering again, which is ignored.
 */
export function registerContribution<
  Slot extends string,
  const Deps extends readonly ContributionDep[] = readonly [],
>(def: ContributionDefinition<Slot, Deps>): void {
  assertSizeDelta(def.id, def.sizeDelta);
  const s = state();
  const existing = s.entries.get(def.id);
  if (existing !== undefined) {
    // Widened through `unknown` because `compute` puts `Deps` in a PARAMETER
    // position (`DepTopics<Deps>`), so a precisely typed definition and the erased
    // `AnyContribution` are not mutually assignable. The registry genuinely
    // stores defs for many slots at once, so erasing `Slot` and `Deps` on the way in
    // is the honest thing; every read hands the entries back to the
    // aggregation, which re-narrows per slot.
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
  warnIfSlotUnknown("contribution", def, def.contributes, (message) =>
    hasHost() ? getHost().logger.warn(message) : console.warn(message),
  );
  s.entries.set(def.id, {
    def: def as unknown as AnyContribution,
    order: s.counter++,
  });
  notifyContributionChange();
}

/**
 * The priority a contribution registers at when it declares none, which is 1.
 * Priority 0 is left below every ordinary contribution, for a host widget
 * filling its own slot with what it can read itself. See
 * {@link getContributionsForSlot}.
 */
export const DEFAULT_CONTRIBUTION_PRIORITY = 1;

/**
 * Every contribution that wins the slot: those in the highest priority band
 * present, in registration order. Useful for filling one of a widget's slots
 * with the entries that apply to the operator's vessel. Used by the contribution
 * runtime that draws a widget's slots.
 *
 * Contributions of equal priority all render, and only a strictly higher band
 * displaces a lower one. A host widget that fills its own slot contributes at
 * one below {@link DEFAULT_CONTRIBUTION_PRIORITY}, so a contribution that can
 * answer where the host cannot replaces the host's rows. A contribution meant
 * to render alongside the host's rows takes the host's band explicitly.
 *
 * A widget that reads its own data this way renders nothing without a
 * `WidgetMetaContext` and a `ContributionsProvider` above it, and it draws an
 * empty widget without raising. See `useContributions` (`@ksp-gonogo/ui-kit`)
 * for what that costs a test, and `clearContributions` below.
 */
export function getContributionsForSlot(slot: string): AnyContribution[] {
  /*
   * Equal priority is not a tie to break. Everyone in the winning band renders,
   * which is what lets two mutually-unaware mods both put their vessels on one
   * diagram; only a strictly higher band displaces. Nothing sets a priority unless
   * it means to, so the ordinary case is one band holding every contributor.
   *
   * What the band buys is a host widget filling its own slot. It contributes
   * what it can read at one below `DEFAULT_CONTRIBUTION_PRIORITY`, so a
   * career overhaul that can answer where the host cannot displaces it instead of
   * appearing beside it as a second copy of the same list. It is the contribution
   * twin of `AugmentDefinition.suppressesVanillaBase`, and it is declared by the
   * contributor rather than by the host for the same reason: the host cannot know
   * which of its guests supersedes it.
   */
  const inSlot = Array.from(state().entries.values()).filter(
    (entry) => entry.def.contributes === slot,
  );
  if (inSlot.length === 0) return [];
  const priorityOf = (entry: (typeof inSlot)[number]): number =>
    entry.def.priority ?? DEFAULT_CONTRIBUTION_PRIORITY;
  const winning = Math.max(...inSlot.map(priorityOf));
  return inSlot
    .filter((entry) => priorityOf(entry) === winning)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.def);
}

/**
 * Every registered contribution, whatever slot it feeds, in registration
 * order. Useful for listing contributions by owner. Used by an Uplink's
 * generated page to list the contributions that Uplink adds.
 *
 * The order is registration order and never priority order: priority orders
 * the entries of one slot, and this list spans slots.
 */
export function getContributions(): AnyContribution[] {
  return Array.from(state().entries.values())
    .sort((a, b) => a.order - b.order)
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

/**
 * Resets the contribution registry to empty. Useful in a test that needs a
 * registry with nothing in it.
 *
 * It empties the registry, which includes the contributions a host widget
 * makes to its own slot. Those register when the module is imported, and
 * nothing re-runs an import, so every case after the first renders a host with
 * none of its own data: a widget that draws its chrome and no content.
 *
 * A self-contributing widget therefore exports a function that performs its
 * registration, for a test to call after clearing. Registering the identical
 * definition again is ignored, so calling it when nothing was cleared is safe.
 */
export function clearContributions(): void {
  const s = state();
  s.entries.clear();
  s.counter = 0;
  notifyContributionChange();
}
