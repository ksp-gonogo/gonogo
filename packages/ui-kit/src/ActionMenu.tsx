import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { groupComboboxOptions } from "./Combobox";
import { EmptyState } from "./EmptyState";
import { focusRingInset } from "./focusRing";

/**
 * One action in an {@link ActionMenu}.
 *
 * @category Floating
 */
export interface ActionMenuItem {
  /** Stable id handed back to `onSelect`. */
  key: string;
  /** The item's visible text, and its accessible name unless `ariaLabel` is set. */
  label: string;
  /** Optional grouping header; ungrouped items collapse into one flat list. */
  group?: string;
  /** Present but not currently firable: rendered dimmed and inert, still reachable. */
  disabled?: boolean;
  /** Overrides the accessible name when `label` alone is ambiguous out of context. */
  ariaLabel?: string;
}

/**
 * Props for {@link ActionMenu}.
 *
 * @category Floating
 */
export interface ActionMenuProps {
  /** The actions, in order. Items sharing a `group` are listed under that heading. */
  items: readonly ActionMenuItem[];
  /** Fired with the item's `key`. A disabled item never fires. */
  onSelect: (key: string) => void;
  /** Escape, Tab, or an outside pointer press. The caller restores trigger focus. */
  onDismiss: () => void;
  /** Accessible name for the menu itself: `role="menu"` needs one. */
  ariaLabel: string;
  /** Positioning (the caller owns anchoring); merged over the menu's own frame styles. */
  style?: CSSProperties;
  /** Rendered above the items: a title row, a pending indicator, a delay readout. */
  header?: ReactNode;
  /** Rendered below the items. */
  footer?: ReactNode;
  /** Shown in place of the items when there are none. Defaults to "No actions". */
  emptyLabel?: string;
  /** Heading for items with no `group` when other items have one. Defaults to "Other". */
  otherLabel?: string;
}

/**
 * A menu of actions to fire: the APG `menu` pattern
 * (https://www.w3.org/WAI/ARIA/apg/patterns/menu/).
 *
 * It differs from {@link ComboboxListbox}, a `listbox` for choosing a value:
 * this is a `menu` for invoking a command, so its items are real `<button>`s,
 * it owns keyboard focus while open, and selecting an item fires it.
 *
 * Keyboard: ArrowDown and ArrowUp walk the items, Home and End jump to the
 * ends, Enter or Space fires the focused item, and Escape or Tab dismisses. A
 * pointer press outside the menu dismisses it. Focus moves to the first item
 * on open; restore focus to the trigger in `onDismiss`. A disabled item stays
 * reachable by keyboard, so it reads as unavailable rather than missing.
 *
 * The menu is absolutely positioned and draws its own raised surface; place
 * it with `style`, or put it in a {@link Floating} with
 * `style={{ position: "static" }}`. Render it only while open.
 *
 * @example
 * ```tsx
 * {menuAnchor && (
 *   <Floating anchor={menuAnchor}>
 *     <ActionMenu
 *       items={[
 *         { key: "deploy", label: "Deploy chute" },
 *         { key: "cut", label: "Cut chute", disabled: !deployed },
 *       ]}
 *       ariaLabel="Parachute actions"
 *       style={{ position: "static" }}
 *       onSelect={(key) => {
 *         fire(key);
 *         close();
 *       }}
 *       onDismiss={close}
 *     />
 *   </Floating>
 * )}
 * ```
 *
 * @category Floating
 */
export function ActionMenu({
  items,
  onSelect,
  onDismiss,
  ariaLabel,
  style,
  header,
  footer,
  emptyLabel = "No actions",
  otherLabel = "Other",
}: Readonly<ActionMenuProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [activeIndex, setActiveIndex] = useState(0);

  const groups = groupComboboxOptions(items, otherLabel);
  const flat = groups.flatMap(([, bucket]) => bucket);

  /*
   * Roving DOM focus, so the real buttons handle Enter/Space. `itemCount` is a
   * dependency because a menu can open before its items arrive; while empty the
   * container itself takes focus so Escape still has somewhere to bubble from.
   */
  const itemCount = flat.length;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (itemCount === 0) {
      container.focus();
      return;
    }
    const buttons =
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons[activeIndex]?.focus();
  }, [activeIndex, itemCount]);

  // Bound on pointerdown, not click, so an outside press dismisses before it can activate anything else.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const container = containerRef.current;
      if (
        container &&
        e.target instanceof Node &&
        !container.contains(e.target)
      ) {
        onDismiss();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
        return;
      }
      // A menu does not trap Tab: it dismisses and focus continues past the trigger.
      if (e.key === "Tab") {
        onDismiss();
        return;
      }
      if (flat.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(flat.length - 1);
          break;
      }
    },
    [flat.length, onDismiss],
  );

  return (
    <Menu
      ref={containerRef}
      // A menu with no menuitem children is invalid ARIA, so the empty state is a plain labelled region.
      role={itemCount > 0 ? "menu" : undefined}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // Programmatic focus only, for the empty state; never a tab stop.
      tabIndex={-1}
      style={style}
    >
      {header}
      {flat.length === 0 ? (
        <EmptyState layout="fill">{emptyLabel}</EmptyState>
      ) : (
        groups.map(([group, bucket], groupIndex) => (
          <div
            key={group}
            {...(groups.length > 1
              ? {
                  role: "group",
                  "aria-labelledby": `${menuId}-group-${groupIndex}`,
                }
              : { role: "none" })}
          >
            {/* A single bucket renders flat, without a header. */}
            {groups.length > 1 ? (
              <GroupHeader
                id={`${menuId}-group-${groupIndex}`}
                aria-hidden="true"
              >
                {group}
              </GroupHeader>
            ) : null}
            {bucket.map((item) => {
              const index = flat.indexOf(item);
              return (
                <MenuItem
                  key={item.key}
                  type="button"
                  role="menuitem"
                  aria-label={item.ariaLabel}
                  // aria-disabled, not `disabled`: a natively disabled button cannot take focus and drops out of the arrow-key walk.
                  aria-disabled={item.disabled}
                  $disabled={item.disabled}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => {
                    if (!item.disabled) onSelect(item.key);
                  }}
                >
                  {item.label}
                </MenuItem>
              );
            })}
          </div>
        ))
      )}
      {footer}
    </Menu>
  );
}

const Menu = styled.div`
  position: absolute;
  min-width: 180px;
  max-width: 280px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  padding: var(--inset-menu-list);
  z-index: var(--z-dropdown);
`;

const GroupHeader = styled.div`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: var(--inset-menu-group-label);
`;

const MenuItem = styled.button<{ $disabled?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  font-size: var(--font-size-compact);
  padding: var(--inset-menu-item);
  cursor: pointer;

  &:hover[aria-disabled="false"],
  &:hover:not([aria-disabled]) {
    background: var(--color-border-subtle);
  }

  ${focusRingInset}
  /* The background marks the focused row where the ring meets the menu border. */
  &:focus-visible {
    background: var(--color-border-subtle);
  }

  &[aria-disabled="true"] {
    color: var(--color-text-faint);
    cursor: default;
  }
`;
