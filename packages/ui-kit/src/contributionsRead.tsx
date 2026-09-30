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

/**
 * One slot's row in a widget's contribution store: the full slot id and the
 * entries its contributions produced, in render order.
 *
 * @category Extensions
 */
export interface ContributionSlotEntry {
  /** The full slot id, such as `"crew-status.badges"`. */
  id: string;
  // A primitive contribution cannot carry a provenance stamp and is stored verbatim, hence the loose type.
  /** The entries, each stamped with its contribution id and owner when it is an object. */
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

/**
 * The standard contribution segments every widget carries: `badges`. It
 * completes to the slot id `${componentId}.badges` for each widget, so an
 * Uplink can fill any widget's header badges with its handle's
 * `registerContribution` without the widget declaring the slot. Each
 * contribution's `compute` returns `BadgeEntry` items; the dashboard supplies
 * them to the widget's {@link Panel}, which draws them after the widget's own
 * `panelBadges` and drops any whose id the widget already uses.
 *
 * @example
 * ```ts
 * EXAMPLE.registerContribution({
 *   id: "cadence-badge",
 *   contributes: "space-center-status.badges",
 *   deps: ["example.heartbeat"],
 *   requires: "example",
 *   compute: (topics) =>
 *     topics["example.heartbeat"]
 *       ? [{ id: "cadence", label: "Publishing", tone: "info" }]
 *       : null,
 * });
 * ```
 *
 * @category Panel
 */
export const FRAMEWORK_CONTRIBUTION_SEGMENTS = [
  "badges",
] as const satisfies readonly ComponentSlotSegment[];

const EMPTY_SLOT_ENTRIES: readonly ContributionSlotEntry[] = Object.freeze([]);

/**
 * The per-widget store of contribution entries, one {@link ContributionSlotEntry}
 * per slot. {@link ContributionsProvider} mounts and fills it; the read hooks
 * ({@link useContributions}, {@link useContributionsBySlotId}) read it. A
 * widget reads through those hooks rather than the store.
 *
 * @category Extensions
 */
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

/**
 * The entries contributed to the slot with the full id `slot`, untyped. Empty
 * when nothing contributes or no contribution store is mounted. Prefer
 * {@link useContributions}, which types the entries from the slot's
 * declaration; use this for a slot id built at runtime.
 *
 * @category Extensions
 */
export function useContributionsBySlotId(slot: string): readonly unknown[] {
  const snapshot = useAllContributionSlots();
  return snapshot.find((e) => e.id === slot)?.entries ?? EMPTY_ENTRIES;
}

/**
 * The entries contributed to a slot, for a widget to draw. Three call shapes:
 *
 * - a full slot id declared in `ContributionRegistry` (`"ship-map.part-meters"`):
 *   its entries, typed and stamped with `contributionId` and `owner`
 * - a component segment (`"badges"`, `"filters"`, `"meters"`): completed to
 *   `${componentId}.<segment>` for the widget it is called in, typed from
 *   `ComponentSlotRegistry`
 * - an array of full slot ids: an object keyed by slot id
 *
 * Only the highest `priority` band of contributions to a slot is present.
 * Without a {@link WidgetMetaContext} and a {@link ContributionsProvider}
 * above the caller it returns empty lists. The dashboard and the test render
 * helpers mount both; a test rendering a widget bare must mount them too.
 *
 * @example
 * ```tsx
 * const badges = useContributions("badges");
 * return badges.map((b) => (
 *   <Badge key={b.id} tone={b.tone}>
 *     {b.label}
 *   </Badge>
 * ));
 * ```
 *
 * @category Extensions
 */
export function useContributions<Slot extends ContributionSlotId>(
  slot: Slot,
): readonly Contributed<ContributionEntry<Slot>>[];
// A reusable component writes only the segment ("filters"), completed from `useWidgetMeta()` and typed via `ComponentSlotRegistry`.
export function useContributions<Segment extends ComponentSlotSegment>(
  segment: Segment,
): readonly ComponentSlotRegistry[Segment][];
// An array of full slot ids.
export function useContributions<
  const Slots extends readonly ContributionSlotId[],
>(
  slots: Slots,
): { [Slot in Slots[number]]: readonly Contributed<ContributionEntry<Slot>>[] };
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
