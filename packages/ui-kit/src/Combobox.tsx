import type { ReactNode } from "react";
import styled from "styled-components";

/**
 * The generalized combobox/listbox primitive extracted from `DataKeyPicker`
 * (kos-terminal-script-picker generalization). `DataKeyPicker` is the first
 * caller to be rebuilt on top of this file; the kOS terminal's `/`-script
 * composer is the second — it drives the listbox from raw keystrokes
 * (xterm's `onData`) rather than a literal `<input>`, so the pure
 * filter/group/navigate functions and the presentational `ComboboxListbox`
 * are kept fully decoupled from any specific input surface.
 */

/** A single selectable item in a combobox/listbox dropdown. */
export interface ComboboxOption {
  key: string;
  label?: string;
  group?: string;
}

/**
 * Case-insensitive substring match against an option's label (falling back
 * to its key) — the default filter every combobox consumer starts from.
 */
export function comboboxOptionMatches(
  option: ComboboxOption,
  query: string,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const label = option.label ?? option.key;
  return (
    label.toLowerCase().includes(q) || option.key.toLowerCase().includes(q)
  );
}

/** Filters `options` against `query` using `matches` (default: `comboboxOptionMatches`). */
export function filterComboboxOptions<T extends ComboboxOption>(
  options: readonly T[],
  query: string,
  matches: (option: T, query: string) => boolean = comboboxOptionMatches,
): T[] {
  return options.filter((o) => matches(o, query));
}

/**
 * Buckets `options` by `.group` (default bucket `otherLabel`), sorted by
 * group name — the grouped-listbox shape combobox consumers render from.
 * Ungrouped callers (every option has no `group`) collapse to a single
 * `otherLabel` bucket, which renders as one flat list.
 */
export function groupComboboxOptions<T extends ComboboxOption>(
  options: readonly T[],
  otherLabel = "Other",
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const o of options) {
    const g = o.group ?? otherLabel;
    let bucket = groups.get(g);
    if (!bucket) {
      bucket = [];
      groups.set(g, bucket);
    }
    bucket.push(o);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Flattens grouped options back into render/navigation order — the order ArrowUp/ArrowDown walk and Enter indexes into. */
export function flattenComboboxGroups<T extends ComboboxOption>(
  groups: ReadonlyArray<[string, T[]]>,
): T[] {
  return groups.flatMap(([, items]) => items);
}

/**
 * Steps the active (highlighted) index by `delta` for one ArrowUp/ArrowDown
 * keypress, clamped to `[0, length - 1]` — never wraps, never goes negative.
 * Returns `-1` when there is nothing to select (`length === 0`).
 */
export function moveComboboxActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) return -1;
  return Math.max(0, Math.min(current + delta, length - 1));
}

export interface ComboboxListboxProps<T extends ComboboxOption> {
  /** DOM id for the listbox element — pair with the owning input's `aria-controls`. */
  id: string;
  groups: ReadonlyArray<[string, T[]]>;
  flatOptions: readonly T[];
  /** Index into `flatOptions` of the currently highlighted item, or `-1` for none. */
  activeIndex: number;
  /** The currently committed value (distinct from `activeIndex`'s in-progress highlight), if any. */
  selectedKey?: string | null;
  getOptionId: (key: string) => string;
  onHoverIndex: (index: number) => void;
  onSelectKey: (key: string) => void;
  /** Custom item body (e.g. label + trailing unit). Defaults to `option.label ?? option.key`. */
  renderItem?: (option: T) => ReactNode;
  emptyLabel?: string;
}

/**
 * The presentational half of the combobox pattern: a `role="listbox"`
 * dropdown of grouped, keyboard-navigable options. Owns no state itself —
 * `activeIndex`/`onHoverIndex`/`onSelectKey` are fully controlled by the
 * caller, so it composes equally well behind a literal `<input
 * role="combobox">` (`DataKeyPicker`) or behind a non-DOM input surface like
 * xterm's `onData` (the kOS terminal's `/`-script composer).
 */
export function ComboboxListbox<T extends ComboboxOption>({
  id,
  groups,
  flatOptions,
  activeIndex,
  selectedKey,
  getOptionId,
  onHoverIndex,
  onSelectKey,
  renderItem,
  emptyLabel = "No matches",
}: Readonly<ComboboxListboxProps<T>>) {
  return (
    <Dropdown role="listbox" id={id}>
      {flatOptions.length === 0 ? (
        <EmptyState>{emptyLabel}</EmptyState>
      ) : (
        groups.map(([group, items]) => (
          <DropdownGroup key={group}>
            <GroupHeader>{group}</GroupHeader>
            {items.map((opt) => {
              const globalIdx = flatOptions.indexOf(opt);
              const isActive = globalIdx === activeIndex;
              return (
                <DropdownItem
                  key={opt.key}
                  id={getOptionId(opt.key)}
                  role="option"
                  aria-selected={isActive}
                  $active={isActive}
                  $selected={opt.key === selectedKey}
                  onPointerDown={(e) => {
                    // Prevent the input from losing focus (and triggering an
                    // outside-click dismiss) before the selection runs.
                    e.preventDefault();
                    onSelectKey(opt.key);
                  }}
                  onMouseEnter={() => onHoverIndex(globalIdx)}
                >
                  {renderItem ? renderItem(opt) : (opt.label ?? opt.key)}
                </DropdownItem>
              );
            })}
          </DropdownGroup>
        ))
      )}
    </Dropdown>
  );
}

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  max-height: 280px;
  overflow-y: auto;
  z-index: 100;
`;

const DropdownGroup = styled.div``;

const GroupHeader = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  padding: 8px 8px 4px;
  position: sticky;
  top: 0;
  background: var(--color-surface-raised);
`;

const DropdownItem = styled.div<{ $active: boolean; $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  cursor: pointer;
  background: ${({ $active, $selected }) =>
    $active
      ? "var(--color-border-subtle)"
      : $selected
        ? "var(--color-status-go-bg)"
        : "transparent"};

  &:hover {
    background: var(--color-border-subtle);
  }
`;

const EmptyState = styled.div`
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-faint);
  text-align: center;
`;
