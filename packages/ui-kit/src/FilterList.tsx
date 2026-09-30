import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Stack } from "./Stack";
import { FilterRegion, type TermSegment, useRowFilter } from "./useRowFilter";

/*
 * A filterable list over pre-processed rows: each carries the text it is
 * searchable by and its rendered node, so FilterList only matches strings.
 *
 * Providers add search terms, shown as toggles, through the universal
 * `filters` contribution segment, completed from the mounting widget's
 * context. Outside a widget the term list is empty and every row passes. The
 * filter model is `useRowFilter`, shared with hosts that render their own rows.
 */

/**
 * One row of a {@link FilterList}: its key, the text it is matched against,
 * and the node to draw.
 *
 * @category FilterList
 */
export interface FilterRow {
  /** Stable React key for the row. */
  id: string;
  /** The text this row is matched against, baked by the widget from its own fields. */
  searchText: string;
  /** The already-rendered row. */
  node: ReactNode;
}

/**
 * Props for {@link FilterList}.
 *
 * @category FilterList
 */
export interface FilterListProps {
  /** Every row, in display order; the list shows the ones that match. */
  rows: readonly FilterRow[];
  /** The contribution segment to pull toggle terms from. Defaults to the universal `filters`. */
  segment?: TermSegment;
  /** Shown when no row matches. Defaults to "Nothing matches the filter". */
  emptyLabel?: ReactNode;
}

/**
 * A filterable list of pre-rendered rows, with its filter control (toggle
 * chips for contributed terms, then a search box) above it. Each row carries
 * the text it is searchable by, so the list only matches strings: a row shows
 * while its `searchText` contains every selected term and the typed text,
 * case-insensitively.
 *
 * The toggle terms come from the `filters` contribution segment of the widget
 * the list is mounted in; outside a widget there are none and only the search
 * box shows. For rows the host renders itself (a table), use
 * {@link useRowFilter} with {@link FilterRegion} instead.
 *
 * @example
 * ```tsx
 * <FilterList
 *   rows={contracts.map((c) => ({
 *     id: c.id,
 *     searchText: `${c.title} ${c.agency}`,
 *     node: <Card title={c.title}>{c.agency}</Card>,
 *   }))}
 *   emptyLabel="No contracts match"
 * />
 * ```
 *
 * @category FilterList
 */
export function FilterList({
  rows,
  segment = "filters",
  emptyLabel = "Nothing matches the filter",
}: FilterListProps) {
  const filter = useRowFilter({ segment });
  const shown = rows.filter((row) => filter.matches(row.searchText));

  return (
    <FilterRegion filter={filter}>
      {shown.length > 0 ? (
        <Stack gap="rows">
          {shown.map((row) => (
            <div key={row.id}>{row.node}</div>
          ))}
        </Stack>
      ) : (
        <EmptyState>{emptyLabel}</EmptyState>
      )}
    </FilterRegion>
  );
}
