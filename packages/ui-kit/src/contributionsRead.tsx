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

/**
 * The host-invariant segments, at RUNTIME, so both halves of the seam agree on
 * which bare names get completed to `${componentId}.<segment>`.
 *
 * It has to be a value and not just `ComponentSlotSegment`, because completion
 * is a runtime decision, and it has to be the same value the aggregation walks,
 * because a name one half completes and the other does not is a slot written
 * under one key and read under another with nothing to say so.
 *
 * The `satisfies` is the ratchet: adding a segment to `ComponentSlotRegistry`
 * without adding it here fails to typecheck, which is what stops the two lists
 * drifting. It runs both ways round on purpose, the tuple against the segment
 * union and the union against the tuple, since either alone catches only one
 * direction of the drift.
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

/**
 * Every contribution that won `slot`, typed against the slot's declared entry
 * via `ContributionRegistry`.
 *
 * <p><b>This returns nothing at all without a `WidgetMetaContext` AND a
 * `ContributionsProvider` above it</b>, and it does so silently: with no store
 * mounted there is nothing to read, and with no meta the provider does not know
 * which slots to aggregate. The dashboard supplies both round every widget
 * (`GridItemContent.tsx`), and so does the render harness (`renderWidget.tsx`),
 * so the app and the probe never notice.</p>
 *
 * <p>A TEST that renders a widget bare does notice, and the failure has no error
 * in it: the widget draws its chrome with empty content. That is survivable
 * while a slot only carries guests, because a widget with no guests is a normal
 * widget. It stops being survivable the moment a widget reads its OWN data
 * through a slot, since then the bare render has lost the widget's whole
 * subject. Eight of `SpaceCenterStatus`'s test files rendered it bare and went
 * blank the day its facility grid moved onto
 * `space-center-status.facilities`; they now mount
 * `packages/components/src/test/contributionHost.tsx`, which is the two
 * providers and nothing else.</p>
 *
 * <p>The companion trap is on `clearContributions`, which removes a host's own
 * contribution along with everyone else's.</p>
 */
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
  // A declared SEGMENT (what a reusable component writes) is completed to
  // `${componentId}.${segment}` from the mounting widget's meta: the runtime
  // half of the segment entry point. Anything else is used as-is.
  //
  // The test is membership of `COMPONENT_SLOT_SEGMENTS`, not the absence of a
  // dot. A dot is a spelling, and reading it as the whole distinction meant an
  // undotted slot id could only ever be per-widget: `plots` is one slot for the
  // app, and under the old rule the arranger asking for it inside a widget was
  // silently handed `landing-status.plots`, a key nothing writes. Outside a
  // widget context there is nothing to complete against, so a segment resolves
  // to nothing (stable empty pass-through).
  const isSegment = (slot: string): boolean =>
    (COMPONENT_SLOT_SEGMENTS as readonly string[]).includes(slot);
  const complete = (slot: string): string =>
    meta && isSegment(slot) ? `${meta.componentId}.${slot}` : slot;
  const read = (slot: string): readonly unknown[] =>
    snapshot.find((e) => e.id === complete(slot))?.entries ?? EMPTY_ENTRIES;

  if (typeof slotOrSlots === "string") return read(slotOrSlots);
  return Object.fromEntries(slotOrSlots.map((slot) => [slot, read(slot)]));
}
