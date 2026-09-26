import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Stack } from "./Stack";
import { type TermSegment, useRowFilter } from "./useRowFilter";

/*
 * A filterable list over pre-processed rows: each carries the text it is
 * searchable by and its rendered node, so FilterList only matches strings.
 *
 * Providers add search terms, shown as toggles, through the universal
 * `filters` contribution segment, completed from the mounting widget's
 * context. Outside a widget the term list is empty and every row passes. The
 * filter model is `useRowFilter`, shared with hosts that render their own rows.
 */

export interface FilterRow {
  /** Stable React key for the row. */
  id: string;
  /** The text this row is matched against, baked by the widget from its own fields. */
  searchText: string;
  /** The already-rendered row. */
  node: ReactNode;
}

export interface FilterListProps {
  rows: readonly FilterRow[];
  /** The contribution segment to pull toggle terms from. Defaults to the universal `filters`. */
  segment?: TermSegment;
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
    <Stack gap="related-dense">
      {shown.length > 0 ? (
        <Stack gap="rows">
          {shown.map((row) => (
            <div key={row.id}>{row.node}</div>
          ))}
        </Stack>
      ) : (
        <EmptyState>{emptyLabel}</EmptyState>
      )}

      {filter.control}
    </Stack>
  );
}
