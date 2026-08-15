import type { ReactNode } from "react";
import type { ComponentSlotSegment } from "./contributions";
import { EmptyState } from "./EmptyState";
import { Stack } from "./Stack";
import { useRowFilter } from "./useRowFilter";

// ---------------------------------------------------------------------------
// A widget-agnostic filterable list (component-extension-slots design §4).
//
// The widget hands it a PRE-PROCESSED row list: each row already carries the
// text it is searchable by (`searchText`) and its rendered node. FilterList has
// no generic over the host's element type and never learns it is handling
// resources, parts, or anything else, it only matches strings.
//
// Contributions arrive through the framework-universal `filters` SEGMENT: a
// reusable component owns its own slot, so a provider adds pre-filled SEARCH
// TERMS (plain strings) that this shows as toggles, using the exact same
// `registerContribution` interface a widget-led slot uses. `useContributions`
// completes `${componentId}.filters` from the mounting widget's context, so a
// widget mounting this declares nothing. Outside a widget context (bare mount /
// probe / test without meta) the term list is stably empty and every row passes
// through, so mounting is the whole lifecycle.
//
// Filter model lives in `useRowFilter`, shared with hosts that render their own
// rows (a table cannot hand its rows over without giving up its columns).
//
// Lives in `@ksp-gonogo/ui-kit`: the contribution read seam (`useContributions`)
// moved into the design floor, so a published, third-party-reachable component
// can own its own `filters` slot without reaching up into `@ksp-gonogo/core`.
// The read hook is spine-free; the per-frame aggregation that feeds it stays in
// core (`ContributionsProvider`), mounted by the host.
// ---------------------------------------------------------------------------

export interface FilterRow {
  /** Stable React key for the row. */
  id: string;
  /** The text this row is matched against, baked by the widget from its own
   *  fields. What goes in here is the widget's entire say over searchability. */
  searchText: string;
  /** The already-rendered row. */
  node: ReactNode;
}

export interface FilterListProps {
  rows: readonly FilterRow[];
  /** The contribution SEGMENT to pull toggle terms from. Defaults to the
   *  framework-universal `filters`; override only for a novel declared segment. */
  segment?: ComponentSlotSegment;
  /** Shown when a filter is active but matches nothing. */
  emptyLabel?: ReactNode;
}

export function FilterList({
  rows,
  segment = "filters",
  emptyLabel = "Nothing matches the filter",
}: FilterListProps) {
  const filter = useRowFilter({ segment });
  const shown = rows.filter((row) => filter.matches(row.searchText));

  return (
    <Stack gap="sm">
      {shown.length > 0 ? (
        <Stack gap="xs">
          {shown.map((row) => (
            <div key={row.id}>{row.node}</div>
          ))}
        </Stack>
      ) : (
        <EmptyState>{emptyLabel}</EmptyState>
      )}

      {/* Search box rendered last (design §4). */}
      {filter.control}
    </Stack>
  );
}
