import { type ReactNode, useId, useState } from "react";
import { Cluster } from "./Cluster";
import type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
} from "./contributions";
import { useContributions } from "./contributionsRead";
import { FilterChip } from "./FilterChip";
import { Field, FieldLabel, Input } from "./Form";
import { Stack } from "./Stack";

export interface RowFilter {
  /**
   * The filter control: contributed toggles, then a search box. Render it
   * wherever it belongs in the host's layout.
   */
  control: ReactNode;
  /** True when the row's searchable text passes every active needle. */
  matches: (searchText: string) => boolean;
  /** Whether anything is narrowing the list right now, for empty-state copy. */
  active: boolean;
}

/**
 * A declared segment whose contributions are plain search terms.
 *
 * Not every segment is: `badges` contributes a `BadgeEntry`, and a badge object
 * is not something this hook can lowercase and substring-match. Constraining the
 * option is what keeps `useContributions(segment)` returning `string` here
 * instead of a union that every line below would have to narrow.
 */
export type TermSegment = {
  [K in ComponentSlotSegment]: ComponentSlotRegistry[K] extends string
    ? K
    : never;
}[ComponentSlotSegment];

export interface UseRowFilterOptions {
  /**
   * The contribution SEGMENT to pull toggle terms from. Defaults to the
   * framework-universal `filters`; override only for a novel declared segment
   * whose entries are search terms.
   */
  segment?: TermSegment;
  /** Accessible name for the search box. Defaults to "Search". */
  label?: string;
  placeholder?: string;
}

/**
 * The filter semantics behind `FilterList`, separated so a host that renders
 * its own rows can share them. A table cannot hand its rows to `FilterList`
 * without giving up its columns, and a second, subtly different filter box
 * next to the first is exactly the kind of drift this package exists to stop.
 *
 * Model, unchanged from `FilterList`: contributed toggles STACK (AND with each
 * other), the free-text box is ANDed on top, every needle a case-insensitive
 * substring. Nothing selected and nothing typed matches everything, so a list
 * hides nothing until an operator narrows it.
 */
export function useRowFilter({
  segment = "filters",
  label = "Search",
  placeholder = "Filter…",
}: UseRowFilterOptions = {}): RowFilter {
  const terms = useContributions(segment);
  // Distinct terms, in contribution order: two providers can land the same
  // word, and a doubled toggle is just noise.
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
    <Stack gap="xs">
      {uniqueTerms.length > 0 && (
        <Cluster
          justify="start"
          gap="xs"
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
        <Input
          id={searchId}
          type="search"
          value={typed}
          placeholder={placeholder}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
    </Stack>
  );

  return {
    control,
    matches: (searchText: string) => {
      const haystack = searchText.toLowerCase();
      return needles.every((needle) => haystack.includes(needle));
    },
    active: needles.length > 0,
  };
}
