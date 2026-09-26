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

/*
 * The contribution READ seam: the per-widget store plus the hooks that read
 * it, spine-free. The WRITE half (the per-frame aggregation that pulls
 * telemetry) mounts this same `ContributionsPanelStore` and writes into it.
 */

export interface ContributionSlotEntry {
  id: string; // the slot id
  // A primitive contribution cannot carry a provenance stamp and is stored verbatim, hence the loose type.
  entries: readonly unknown[];
}

const EMPTY_ENTRIES: readonly unknown[] = Object.freeze([]);

/**
 * The host-invariant segments at RUNTIME, so both halves of the seam agree on
 * which bare names complete to `${componentId}.<segment>`. Checked against
 * `ComponentSlotSegment` in both directions, so the two lists cannot drift.
 */
export const COMPONENT_SLOT_SEGMENTS = [
  "badges",
  "filters",
  "meters",
] as const satisfies readonly ComponentSlotSegment[];

type _EverySegmentListed =
  ComponentSlotSegment extends (typeof COMPONENT_SLOT_SEGMENTS)[number]
    ? true
    : never;
const _everySegmentListed: _EverySegmentListed = true;
void _everySegmentListed;

const EMPTY_SLOT_ENTRIES: readonly ContributionSlotEntry[] = Object.freeze([]);

export const ContributionsPanelStore = createPanelStore<
  Store<ContributionSlotEntry>
>(() => createStore<ContributionSlotEntry>());

/** The single subscription point: one `useSyncExternalStore` for the whole store, however many slots are read. */
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

/** An untyped read by slot string. */
export function useContributionsBySlotId(slot: string): readonly unknown[] {
  const snapshot = useAllContributionSlots();
  return snapshot.find((e) => e.id === slot)?.entries ?? EMPTY_ENTRIES;
}

/**
 * Every contribution that won `slot`, typed against the slot's declared entry
 * via `ContributionRegistry`.
 *
 * <p><b>This returns nothing at all without a `WidgetMetaContext` AND a
 * `ContributionsProvider` above it</b>, silently. The dashboard and the render
 * harness supply both; a test rendering a widget bare must mount them too, or
 * a widget that reads its OWN data through a slot draws empty.</p>
 */
export function useContributions<S extends ContributionSlotId>(
  slot: S,
): readonly Contributed<ContributionEntry<S>>[];
// A reusable component writes only the segment ("filters"), completed from `useWidgetMeta()` and typed via `ComponentSlotRegistry`.
export function useContributions<Seg extends ComponentSlotSegment>(
  segment: Seg,
): readonly ComponentSlotRegistry[Seg][];
// An array of full slot ids.
export function useContributions<const T extends readonly ContributionSlotId[]>(
  slots: T,
): { [K in T[number]]: readonly Contributed<ContributionEntry<K>>[] };
export function useContributions(
  slotOrSlots: string | readonly string[],
): unknown {
  const meta = useWidgetMeta();
  const snapshot = useAllContributionSlots();
  /*
   * A declared SEGMENT is completed to `${componentId}.${segment}`; anything
   * else is used as-is. The test is membership of `COMPONENT_SLOT_SEGMENTS`,
   * not the absence of a dot, since an undotted slot id can be app-wide.
   */
  const isSegment = (slot: string): boolean =>
    (COMPONENT_SLOT_SEGMENTS as readonly string[]).includes(slot);
  const complete = (slot: string): string =>
    meta && isSegment(slot) ? `${meta.componentId}.${slot}` : slot;
  const read = (slot: string): readonly unknown[] =>
    snapshot.find((e) => e.id === complete(slot))?.entries ?? EMPTY_ENTRIES;

  if (typeof slotOrSlots === "string") return read(slotOrSlots);
  return Object.fromEntries(slotOrSlots.map((slot) => [slot, read(slot)]));
}
