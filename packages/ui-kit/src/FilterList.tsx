import { type ReactNode, useId, useState } from "react";
import { Cluster } from "./Cluster";
import type { ComponentSlotSegment } from "./contributions";
import { useContributions } from "./contributionsRead";
import { EmptyState } from "./EmptyState";
import { FilterChip } from "./FilterChip";
import { Field, FieldLabel, Input } from "./Form";
import { Stack } from "./Stack";

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
// Filter model: contributed toggles STACK (AND with each other), the free-text
// box is ANDed on top and applied last, every needle a case-insensitive
// substring. Nothing selected and nothing typed shows everything, the resting
// state, so the list hides nothing until an operator narrows it.
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
  const terms = useContributions(segment);
  // Distinct terms, in contribution order: two providers can land the same
  // word, and a doubled toggle is just noise.
  const uniqueTerms = [...new Set(terms)];

  const [active, setActive] = useState<ReadonlySet<string>>(() => new Set());
  const [typed, setTyped] = useState("");
  const searchId = useId();

  const toggle = (term: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  };

  // Toggles stack, the typed box is ANDed on top and applied last. Empty
  // needles are dropped so the resting state passes everything through.
  const needles = [...active, typed]
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  const shown = rows.filter((row) => {
    const haystack = row.searchText.toLowerCase();
    return needles.every((needle) => haystack.includes(needle));
  });

  return (
    <Stack gap="sm">
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
              selected={active.has(term)}
              onToggle={() => toggle(term)}
            />
          ))}
        </Cluster>
      )}

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
      <Field>
        <FieldLabel htmlFor={searchId}>Search</FieldLabel>
        <Input
          id={searchId}
          type="search"
          value={typed}
          placeholder="Filter…"
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
    </Stack>
  );
}
