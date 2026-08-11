import type { FilterEntry, FilterSelection } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useMemo, useState } from "react";
import type { ContributionEntry, ContributionSlotId } from "./contributions";
import { useContributionsBySlotId } from "./contributionsRuntime";

// ---------------------------------------------------------------------------
// Contributable list filters (contribution-slots-spec §15), the host half.
//
// A widget with a filterable list declares a `<widget-id>.filters` slot whose
// entry is a `FilterEntry` over its own row type, calls this hook, hands
// `groups` to ui-kit's `<FilterBar>` and its rows to `apply`. It never learns
// what any filter means: the taxonomy belongs to whoever contributed it, which
// is the whole point (the app for a generic axis, an Uplink for its mod's own).
//
// Everything else the mechanism needs already exists on the contributions
// registry underneath: Domain gating (`requires`), ordering (`priority`),
// per-slot PerfBudget, error isolation, owner namespacing. This module adds
// only what is specific to filters: grouping, selection state, and application.
// ---------------------------------------------------------------------------

/** One facet, as the host renders it. */
export interface ContributedFilterOption {
  /** Host-side option id, namespaced by contribution so two contributors
   *  feeding one group cannot collide on a local id. */
  id: string;
  label: string;
  active: boolean;
}

/** One axis, as the host renders it. */
export interface ContributedFilterGroup {
  id: string;
  /** Undefined for a standalone filter that contributed no group label. */
  label?: string;
  selection: FilterSelection;
  options: readonly ContributedFilterOption[];
}

export interface ContributedFilters<T> {
  /** Render-ready axes, in contribution order. Empty when nothing contributed. */
  groups: readonly ContributedFilterGroup[];
  /** Replace one group's selection. Pass an empty array to clear it. */
  onChange: (groupId: string, selectedOptionIds: readonly string[]) => void;
  /** Keeps the items that pass: OR within a group, AND across groups. */
  apply: (items: readonly T[]) => readonly T[];
  /** Selected facets across every group; 0 means nothing is being hidden. */
  activeCount: number;
}

/** The row type a slot's filters run against, read back off its entry type. */
type FilterItem<S extends string> =
  ContributionEntry<S> extends FilterEntry<infer T> ? T : unknown;

interface ResolvedOption {
  optionId: string;
  groupId: string;
  predicate: (item: unknown) => boolean;
}

/**
 * Read a widget's contributed filters, hold the operator's selection, and apply
 * it. Show-all is the default and the resting state: with nothing selected
 * every item passes, so nothing is hidden until an operator hides it.
 *
 * Stale filters need no handling by the caller. A contribution stops emitting a
 * facet as soon as the data behind it is gone (a resource this vessel no longer
 * carries, an Uplink whose Domain went away), so a selection naming it simply
 * stops matching anything present and is ignored, and a group left with no live
 * selection is back to showing everything. The selection is deliberately NOT
 * pruned from state on the way through: a facet that comes back (a vessel
 * docking, a stream reconnecting) restores the operator's choice with it.
 */
export function useContributedFilters<S extends ContributionSlotId>(
  slot: S,
): ContributedFilters<FilterItem<S>> {
  const entries = useContributionsBySlotId(slot);
  const [selected, setSelected] = useState<Record<string, readonly string[]>>(
    {},
  );

  const resolved = useMemo(() => {
    const options: ResolvedOption[] = [];
    const groups: ContributedFilterGroup[] = [];
    const byGroupId = new Map<string, ContributedFilterGroup>();

    for (const raw of entries) {
      const entry = raw as unknown as FilterEntry<unknown> & {
        contributionId: string;
      };
      if (typeof entry?.predicate !== "function") continue;

      // A standalone filter is its own group of one, so the host renders and
      // combines everything the same way with no special case.
      const groupId = entry.group ?? `${entry.contributionId}:${entry.id}`;
      const optionId = `${entry.contributionId}:${entry.id}`;

      let group = byGroupId.get(groupId);
      if (!group) {
        group = {
          id: groupId,
          label: entry.groupLabel,
          // First entry of a group to state its semantics wins, so a group fed
          // by two contributions keeps what its first contributor declared.
          selection: entry.selection ?? "multi",
          options: [],
        };
        byGroupId.set(groupId, group);
        groups.push(group);
      }

      (group.options as ContributedFilterOption[]).push({
        id: optionId,
        label: entry.label,
        active: false,
      });
      options.push({
        optionId,
        groupId,
        predicate: entry.predicate as (item: unknown) => boolean,
      });
    }

    return { groups, options };
  }, [entries]);

  // The selection intersected with what is actually contributed right now: the
  // state may name facets that have gone away, and those must not narrow
  // anything or show up as pressed toggles.
  const live = useMemo(() => {
    const present = new Set(resolved.options.map((o) => o.optionId));
    const out = new Map<string, Set<string>>();
    for (const group of resolved.groups) {
      const picked = (selected[group.id] ?? []).filter((id) => present.has(id));
      if (picked.length > 0) out.set(group.id, new Set(picked));
    }
    return out;
  }, [resolved, selected]);

  const groups = useMemo(
    () =>
      resolved.groups.map((group) => ({
        ...group,
        options: group.options.map((option) => ({
          ...option,
          active: live.get(group.id)?.has(option.id) === true,
        })),
      })),
    [resolved.groups, live],
  );

  const onChange = useCallback(
    (groupId: string, selectedOptionIds: readonly string[]) => {
      setSelected((prev) => ({ ...prev, [groupId]: [...selectedOptionIds] }));
    },
    [],
  );

  const apply = useCallback(
    (items: readonly FilterItem<S>[]): readonly FilterItem<S>[] => {
      if (live.size === 0) return items;
      const predicatesByGroup = new Map<
        string,
        ((item: unknown) => boolean)[]
      >();
      for (const option of resolved.options) {
        if (live.get(option.groupId)?.has(option.optionId) !== true) continue;
        const list = predicatesByGroup.get(option.groupId) ?? [];
        list.push(option.predicate);
        predicatesByGroup.set(option.groupId, list);
      }
      if (predicatesByGroup.size === 0) return items;

      return items.filter((item) => {
        for (const predicates of predicatesByGroup.values()) {
          // OR within a group (independent facets of one axis), AND across
          // groups (each axis narrows what the previous one left).
          if (!predicates.some((predicate) => predicate(item))) return false;
        }
        return true;
      });
    },
    [live, resolved.options],
  );

  const activeCount = useMemo(() => {
    let count = 0;
    for (const picked of live.values()) count += picked.size;
    return count;
  }, [live]);

  return { groups, onChange, apply, activeCount };
}
