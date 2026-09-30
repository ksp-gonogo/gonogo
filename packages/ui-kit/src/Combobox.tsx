import type { ReactNode } from "react";
import styled from "styled-components";
import { EmptyState } from "./EmptyState";
import { statusFill } from "./tone";

/*
 * The combobox/listbox primitive. The pure filter/group/navigate functions and
 * the presentational `ComboboxListbox` are decoupled from any input surface, so
 * a caller can drive them from a literal `<input role="combobox">` or from raw
 * keystrokes.
 */

/**
 * A single selectable item in a combobox or listbox dropdown. Extend it to carry more per option.
 *
 * @category Form
 */
export interface ComboboxOption {
  /** Unique within the list; what a selection reports. */
  key: string;
  /** What the operator reads. Defaults to the option's key. */
  label?: string;
  /** The heading the option is listed under. Options with none share one bucket. */
  group?: string;
}

/**
 * Case-insensitive substring match against an option's label (falling back
 * to its key): the default filter every combobox consumer starts from.
 *
 * @category Form
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

/**
 * Filters `options` against `query` using `matches`, by default a case-insensitive substring match on the label or key.
 *
 * @category Form
 */
export function filterComboboxOptions<Option extends ComboboxOption>(
  options: readonly Option[],
  query: string,
  matches: (option: Option, query: string) => boolean = comboboxOptionMatches,
): Option[] {
  return options.filter((o) => matches(o, query));
}

/**
 * Buckets `options` by `.group` (default bucket `otherLabel`), sorted by
 * group name: the grouped-listbox shape combobox consumers render from.
 * Ungrouped callers (every option has no `group`) collapse to a single
 * `otherLabel` bucket, which renders as one flat list.
 *
 * @category Form
 */
export function groupComboboxOptions<Option extends ComboboxOption>(
  options: readonly Option[],
  otherLabel = "Other",
): Array<[string, Option[]]> {
  const groups = new Map<string, Option[]>();
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

/**
 * Flattens grouped options back into render and navigation order: the order ArrowUp and ArrowDown walk, and what `activeIndex` indexes into.
 *
 * @category Form
 */
export function flattenComboboxGroups<Option extends ComboboxOption>(
  groups: ReadonlyArray<[string, Option[]]>,
): Option[] {
  return groups.flatMap(([, items]) => items);
}

/**
 * Steps the active (highlighted) index by `delta` for one ArrowUp/ArrowDown
 * keypress, clamped to `[0, length - 1]`; never wraps, never goes negative.
 * Returns `-1` when there is nothing to select (`length === 0`).
 *
 * @category Form
 */
export function moveComboboxActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) return -1;
  return Math.max(0, Math.min(current + delta, length - 1));
}

/**
 * Props for {@link ComboboxListbox}.
 *
 * @category Form
 */
export interface ComboboxListboxProps<Option extends ComboboxOption> {
  /** DOM id for the listbox element: pair with the owning input's `aria-controls`. */
  id: string;
  /** The options to show, bucketed by {@link groupComboboxOptions}. */
  groups: ReadonlyArray<[string, Option[]]>;
  /** The same options in navigation order, from {@link flattenComboboxGroups}. */
  flatOptions: readonly Option[];
  /** Index into `flatOptions` of the currently highlighted item, or `-1` for none. */
  activeIndex: number;
  /** The currently committed value (distinct from `activeIndex`'s in-progress highlight), if any. */
  selectedKey?: string | null;
  /** The DOM id of an option, for the owning input's `aria-activedescendant`. */
  getOptionId: (key: string) => string;
  /** Called with a `flatOptions` index when the pointer moves over an option. */
  onHoverIndex: (index: number) => void;
  /** Called with an option's key when it is clicked or tapped. */
  onSelectKey: (key: string) => void;
  /** Custom item body, such as a label with a trailing unit. Defaults to the option's label, or its key when it has none. */
  renderItem?: (option: Option) => ReactNode;
  /** Shown when `flatOptions` is empty. Defaults to "No matches". */
  emptyLabel?: string;
  /**
   * Accessible name for the listbox itself. Pass one whenever the owning
   * control is not a literal `<input role="combobox">`, since an unnamed
   * `role="listbox"` is an accessibility violation.
   */
  ariaLabel?: string;
  /**
   * Which side of the control the list opens on. Defaults to `"below"`.
   * `"above"` is for a control at the foot of a clipping container, such as a
   * console composer, where a downward list would be clipped away.
   */
  placement?: "below" | "above";
}

/**
 * The presentational half of the combobox pattern: a `role="listbox"`
 * dropdown of grouped, keyboard-navigable options. Owns no state:
 * `activeIndex`, `onHoverIndex` and `onSelectKey` are fully controlled by the
 * caller, who drives them with {@link filterComboboxOptions},
 * {@link groupComboboxOptions}, {@link flattenComboboxGroups} and
 * {@link moveComboboxActiveIndex}. The list is absolutely positioned, so put it
 * in a `position: relative` container beside the input. Pressing an option
 * does not take focus from the input.
 *
 * @example
 * ```tsx
 * const [query, setQuery] = useState("");
 * const [open, setOpen] = useState(false);
 * const [active, setActive] = useState(-1);
 * const listId = useId();
 * const optionId = (key: string) => `${listId}-${key}`;
 * const groups = groupComboboxOptions(filterComboboxOptions(options, query));
 * const flat = flattenComboboxGroups(groups);
 *
 * <div style={{ position: "relative" }}>
 *   <Input
 *     role="combobox"
 *     aria-label="Body"
 *     aria-expanded={open}
 *     aria-controls={listId}
 *     aria-autocomplete="list"
 *     aria-activedescendant={active >= 0 ? optionId(flat[active].key) : undefined}
 *     value={query}
 *     onFocus={() => setOpen(true)}
 *     onBlur={() => setOpen(false)}
 *     onChange={(e) => {
 *       setQuery(e.target.value);
 *       setActive(-1);
 *     }}
 *     onKeyDown={(e) => {
 *       if (e.key === "ArrowDown") setActive((i) => moveComboboxActiveIndex(i, 1, flat.length));
 *       if (e.key === "ArrowUp") setActive((i) => moveComboboxActiveIndex(i, -1, flat.length));
 *       if (e.key === "Enter" && flat[active]) onPick(flat[active].key);
 *       if (e.key === "Escape") setOpen(false);
 *     }}
 *   />
 *   {open && (
 *     <ComboboxListbox
 *       id={listId}
 *       groups={groups}
 *       flatOptions={flat}
 *       activeIndex={active}
 *       selectedKey={selected}
 *       getOptionId={optionId}
 *       onHoverIndex={setActive}
 *       onSelectKey={onPick}
 *     />
 *   )}
 * </div>
 * ```
 *
 * @category Form
 */
export function ComboboxListbox<Option extends ComboboxOption>({
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
  ariaLabel,
  placement = "below",
}: Readonly<ComboboxListboxProps<Option>>) {
  return (
    <Dropdown
      role="listbox"
      id={id}
      aria-label={ariaLabel}
      $placement={placement}
    >
      {flatOptions.length === 0 ? (
        <EmptyState layout="fill">{emptyLabel}</EmptyState>
      ) : (
        groups.map(([group, items], groupIndex) => (
          <DropdownGroup
            key={group}
            role="group"
            aria-labelledby={`${id}-group-${groupIndex}`}
          >
            <GroupHeader id={`${id}-group-${groupIndex}`} aria-hidden="true">
              {group}
            </GroupHeader>
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
                    // Prevent the input from losing focus (and triggering an outside-click dismiss) before the selection runs.
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

const Dropdown = styled.div<{ $placement: "below" | "above" }>`
  position: absolute;
  ${({ $placement }) =>
    $placement === "above"
      ? "bottom: calc(100% + 2px);"
      : "top: calc(100% + 2px);"}
  left: 0;
  right: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  max-height: 280px;
  overflow-y: auto;
  z-index: var(--z-dropdown);
`;

const DropdownGroup = styled.div``;

const GroupHeader = styled.div`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: var(--inset-menu-group-label);
  position: sticky;
  top: 0;
  background: var(--color-surface-raised);
`;

/** The option under the keyboard or pointer sits on the panel ground beside the focus bar; the committed option, when not highlighted, sits on the go status fill. */
function optionFill(active: boolean, selected: boolean): string {
  if (active) return "background: var(--color-surface-panel);";
  if (selected) return statusFill("go");
  return "background: transparent;";
}

const DropdownItem = styled.div<{ $active: boolean; $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--inset-menu-item);
  cursor: pointer;
  ${({ $active, $selected }) => optionFill($active, $selected)}
  /* Focus stays on the input, so the highlighted option carries the focus colour as an inset bar. */
  box-shadow: ${({ $active }) =>
    $active ? "inset 3px 0 0 var(--color-focus)" : "none"};

  &:hover {
    background: var(--color-surface-panel);
  }
`;
