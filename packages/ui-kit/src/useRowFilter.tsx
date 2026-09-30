import { type ReactNode, useId, useState } from "react";
import { Cluster } from "./Cluster";
import type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
} from "./contributions";
import { useContributions } from "./contributionsRead";
import { FilterChip } from "./FilterChip";
import { Field, FieldLabel } from "./Form";
import { SearchBox } from "./SearchBox";
import { Stack } from "./Stack";

/**
 * A filter made by {@link useRowFilter}. Test each row with `matches`. Its
 * control (contributed toggles, then a search box) is not part of this object:
 * it renders above the list it narrows when the filter is passed to
 * {@link FilterRegion} or to `Panel`'s `panelFilter`.
 *
 * @category FilterList
 */
export interface RowFilter {
  /** True when the row's searchable text passes every active needle. */
  matches: (searchText: string) => boolean;
  /** Whether anything is narrowing the list right now, for empty-state copy. */
  active: boolean;
}

/**
 * A declared segment whose contributions are plain search terms. `badges`, for
 * one, contributes a `BadgeEntry`, which cannot be substring-matched.
 */
export type TermSegment = {
  [Segment in ComponentSlotSegment]: ComponentSlotRegistry[Segment] extends string
    ? Segment
    : never;
}[ComponentSlotSegment];

/**
 * Options for {@link useRowFilter}.
 *
 * @category FilterList
 */
export interface UseRowFilterOptions {
  /**
   * The contribution segment to pull toggle terms from. Defaults to the
   * universal `filters`; override it only for a declared segment of your own
   * whose entries are search terms.
   */
  segment?: TermSegment;
  /** Accessible name for the search box. Defaults to "Search". */
  label?: string;
  /** Placeholder in the search box. Defaults to "Filter...". */
  placeholder?: string;
}

/**
 * The filter behind {@link FilterList}, for a host that renders its own rows,
 * such as a table that must keep its columns.
 *
 * Selected toggle terms and the typed text all have to match: each is a
 * case-insensitive substring of the row's search text. Nothing selected and
 * nothing typed matches everything, and `active` is then false. The toggle
 * terms come from the widget's contributions, each term listed once. Place the
 * filter's control by passing the result to {@link FilterRegion} around the
 * list, or to `Panel`'s `panelFilter` for a filter over the whole body.
 *
 * @example
 * ```tsx
 * const filter = useRowFilter({ placeholder: "Filter subjects..." });
 * const shown = subjects.filter((s) => filter.matches(`${s.title} ${s.biome}`));
 *
 * return (
 *   <FilterRegion filter={filter} fill>
 *     {shown.length > 0 ? (
 *       <SubjectTable rows={shown} />
 *     ) : (
 *       <EmptyState>
 *         {filter.active ? "Nothing matches the filter" : "No subjects yet"}
 *       </EmptyState>
 *     )}
 *   </FilterRegion>
 * );
 * ```
 *
 * @category FilterList
 */
export function useRowFilter({
  segment = "filters",
  label = "Search",
  placeholder = "Filter...",
}: UseRowFilterOptions = {}): RowFilter {
  const terms = useContributions(segment);
  // Distinct terms, in contribution order: two providers can land the same word, and a doubled toggle is just noise.
  const uniqueTerms = [...new Set(terms)];

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [typed, setTyped] = useState("");
  const searchId = useId();

  const toggle = (term: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  };

  const needles = [...selected, typed]
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());

  const control = (
    <Stack gap="related-packed">
      {uniqueTerms.length > 0 && (
        <Cluster
          justify="start"
          gap="related-packed"
          wrap
          role="group"
          aria-label="Filters"
        >
          {uniqueTerms.map((term) => (
            <FilterChip
              key={term}
              label={term}
              selected={selected.has(term)}
              onToggle={() => toggle(term)}
            />
          ))}
        </Cluster>
      )}
      <Field>
        <FieldLabel htmlFor={searchId}>{label}</FieldLabel>
        <SearchBox
          id={searchId}
          value={typed}
          placeholder={placeholder}
          onChange={setTyped}
        />
      </Field>
    </Stack>
  );

  const filter: RowFilter = {
    matches: (searchText: string) => {
      const haystack = searchText.toLowerCase();
      return needles.every((needle) => haystack.includes(needle));
    },
    active: needles.length > 0,
  };
  CONTROLS.set(filter, control);
  return filter;
}

const CONTROLS = new WeakMap<RowFilter, ReactNode>();

/** The control of a filter made by `useRowFilter`. Kit-internal: hosts place it through `FilterRegion` or `panelFilter`. */
export function filterControlOf(filter: RowFilter): ReactNode {
  return CONTROLS.get(filter) ?? null;
}

/**
 * The props of {@link FilterRegion}.
 *
 * @category FilterList
 */
export interface FilterRegionProps {
  /** The filter from {@link useRowFilter} whose control is drawn. */
  filter: RowFilter;
  /** The list the filter narrows, drawn under its control. */
  children?: ReactNode;
  /** Take the remaining height, for a region whose list scrolls. */
  fill?: boolean;
}

/**
 * A filtered list with its filter control above it: the way to place a
 * {@link useRowFilter} control inside a widget body. It does not filter the
 * children itself; filter them with the same `filter.matches`.
 *
 * @category FilterList
 */
export function FilterRegion({
  filter,
  children,
  fill = false,
}: FilterRegionProps) {
  return (
    <Stack gap="related-dense" fill={fill}>
      {filterControlOf(filter)}
      {children}
    </Stack>
  );
}
