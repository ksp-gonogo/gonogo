import { useCallback, useSyncExternalStore } from "react";
import type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  Contributed,
  ContributionEntry,
  ContributionSlotId,
} from "./contributions";
import { createPanelStore } from "./store/createPanelStore";
import { createStore, type Store } from "./store/createStore";
import { useWidgetMeta } from "./WidgetMetaContext";

// ---------------------------------------------------------------------------
// The contribution READ seam: the per-widget store plus the hooks that read it.
// Spine-free by construction (no sitrep-client, no telemetry), so it lives in
// the published design floor next to the store factory it uses. The WRITE half
// (the per-frame aggregation that pulls telemetry) stays in `@ksp-gonogo/core`
// (`contributionsRuntime.tsx`): it needs sitrep-client values and must not sit
// below the spine. Both halves share this single `ContributionsPanelStore`
// instance: core's `ContributionsProvider` mounts it and writes, these hooks
// read it.
// ---------------------------------------------------------------------------

export interface ContributionSlotEntry {
  id: string; // the slot id
  // Object contributions are stamped into `Contributed<>` rows; a PRIMITIVE
  // contribution (a `filters` segment's search terms, plain strings) is stored
  // verbatim, since a primitive cannot carry a provenance stamp. Hence the
  // loose element type, narrowed back per slot by the public read overloads.
  entries: readonly unknown[];
}

const EMPTY_ENTRIES: readonly unknown[] = Object.freeze([]);

// Stable empty snapshot for the no-store case (a bare widget or a test
// rendered without a `ContributionsProvider`). Same referential-stability
// requirement as `EMPTY_ENTRIES` above, just typed for the whole-slot-array
// shape `useAllContributionSlots` returns.
const EMPTY_SLOT_ENTRIES: readonly ContributionSlotEntry[] = Object.freeze([]);

export const ContributionsPanelStore = createPanelStore<
  Store<ContributionSlotEntry>
>(() => createStore<ContributionSlotEntry>());

/**
 * The single subscription point: the whole per-widget store's slot-entry
 * array, one `useSyncExternalStore` regardless of how many slots the caller
 * ultimately reads. Both `useContributionsBySlotId` and `useContributions`
 * build on this instead of each subscribing per slot, since the store
 * already holds every slot's entries together and a plain `.find` is all a
 * single-slot read needs.
 */
function useAllContributionSlots(): readonly ContributionSlotEntry[] {
  const store = ContributionsPanelStore.useStore();
  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(onChange) : () => {}),
    [store],
  );
  const getSnapshot = useCallback(
    (): readonly ContributionSlotEntry[] =>
      store ? store.getSnapshot() : EMPTY_SLOT_ENTRIES,
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Untyped-by-slot-string read, shared by both public useContributions overloads and Task 2.3's useWidgetBadges. */
export function useContributionsBySlotId(slot: string): readonly unknown[] {
  const snapshot = useAllContributionSlots();
  return snapshot.find((e) => e.id === slot)?.entries ?? EMPTY_ENTRIES;
}

// Full slot id (host-specific / widget-led): unchanged, typed against the
// slot's declared entry via `ContributionRegistry`.
export function useContributions<S extends ContributionSlotId>(
  slot: S,
): readonly Contributed<ContributionEntry<S>>[];
// SEGMENT (host-invariant component slot): the additive entry point. A reusable
// component writes only the segment ("filters"); the hook completes
// `${componentId}.${segment}` from `useWidgetMeta()` and runs the identical
// aggregation. Typed against the segment's entry via `ComponentSlotRegistry`
// (e.g. `filters` -> `string`), which is why `FilterList` gets `string[]` back.
export function useContributions<Seg extends ComponentSlotSegment>(
  segment: Seg,
): readonly ComponentSlotRegistry[Seg][];
// Array of full slot ids: unchanged.
export function useContributions<const T extends readonly ContributionSlotId[]>(
  slots: T,
): { [K in T[number]]: readonly Contributed<ContributionEntry<K>>[] };
export function useContributions(
  slotOrSlots: string | readonly string[],
): unknown {
  const meta = useWidgetMeta();
  const snapshot = useAllContributionSlots();
  // A bare SEGMENT (no dot, what a reusable component writes) is completed to
  // `${componentId}.${segment}` from the mounting widget's meta: the runtime
  // half of the segment entry point. A full slot id (dotted, what every
  // existing caller passes) is used as-is, so those callers stay byte-
  // unchanged. Outside a widget context there is nothing to complete against,
  // so a bare segment resolves to nothing (stable empty pass-through).
  const complete = (slot: string): string =>
    meta && !slot.includes(".") ? `${meta.componentId}.${slot}` : slot;
  const read = (slot: string): readonly unknown[] =>
    snapshot.find((e) => e.id === complete(slot))?.entries ?? EMPTY_ENTRIES;

  if (typeof slotOrSlots === "string") return read(slotOrSlots);
  return Object.fromEntries(slotOrSlots.map((slot) => [slot, read(slot)]));
}
