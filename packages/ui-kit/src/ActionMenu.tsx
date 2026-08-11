import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { groupComboboxOptions } from "./Combobox";
import { EmptyState } from "./EmptyState";

/**
 * An anchored menu of actions to fire: the APG `menu` pattern
 * (https://www.w3.org/WAI/ARIA/apg/patterns/menu/) as a ui-kit primitive.
 *
 * <p>Distinct from {@link ComboboxListbox}, which is a `listbox` for CHOOSING a
 * value: this is a `menu` for INVOKING a command, so its items are real
 * `<button>`s, it owns keyboard focus while open, and selecting one fires
 * rather than commits. The two patterns have different roles and different
 * keyboard contracts, so they are separate components sharing the one piece
 * that genuinely is common, {@link groupComboboxOptions}, rather than one
 * component bent to serve both.</p>
 *
 * <p>Keyboard: ArrowDown/ArrowUp walk items, Home/End jump to the ends,
 * Enter/Space fire the focused item (native `<button>` behaviour), Escape
 * dismisses, and Tab dismisses too (a menu does not hold Tab focus, per APG).
 * A pointer press outside dismisses. Focus moves to the first item on open and
 * the caller is responsible for restoring focus to the trigger on dismiss.</p>
 *
 * <p>A disabled item stays reachable by keyboard rather than being skipped:
 * per APG either is allowed, and a control the operator can reach is a control
 * that can explain why it is unavailable, whereas a silently-skipped one just
 * seems to be missing.</p>
 */
export interface ActionMenuItem {
  /** Stable id handed back to `onSelect`. */
  key: string;
  label: string;
  /** Optional grouping header; ungrouped items collapse into one flat list. */
  group?: string;
  /** Present but not currently firable: rendered dimmed and inert, still reachable. */
  disabled?: boolean;
  /** Overrides the accessible name when `label` alone is ambiguous out of context. */
  ariaLabel?: string;
}

export interface ActionMenuProps {
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
  emptyLabel?: string;
  /** Bucket name for items with no `group`. */
  otherLabel?: string;
}

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
  const [activeIndex, setActiveIndex] = useState(0);

  const groups = groupComboboxOptions(items, otherLabel);
  const flat = groups.flatMap(([, bucket]) => bucket);

  // Focus follows the active index (roving focus, not aria-activedescendant):
  // the items are real buttons, so real DOM focus is what makes Enter/Space
  // work without re-implementing activation.
  // `itemCount` is read here on purpose, not just listed: a menu can open before
  // its items arrive (an async action list), and then `activeIndex` never
  // changes, so without the count in the dependencies focus would never land on
  // the first item once it rendered.
  //
  // The EMPTY case focuses the menu container itself rather than doing nothing.
  // A menu that opens before its items have travelled would otherwise leave
  // focus outside itself, and then Escape (handled here, by bubbling) would
  // never reach it: the operator opens a menu, presses Escape, and nothing
  // happens. Owning focus from the moment it opens is what makes dismissal
  // work at every point in the menu's life, not just once it has content.
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

  // An outside pointer press dismisses. Bound on pointerdown (not click) so a
  // press that starts outside dismisses before it can activate anything else.
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
      // A menu does not keep Tab focus: Tab dismisses and lets focus continue
      // past the trigger, rather than trapping the operator inside.
      if (e.key === "Tab") {
        onDismiss();
        return;
      }
      if (flat.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(flat.length - 1);
      }
    },
    [flat.length, onDismiss],
  );

  return (
    <Menu
      ref={containerRef}
      // `role="menu"` ONLY once there are items: a menu with no menuitem
      // children is invalid ARIA (axe's aria-required-children), and an empty
      // menu is a real state here, it opens before its actions have travelled.
      // While empty it is a plain labelled region carrying the waiting message.
      role={itemCount > 0 ? "menu" : undefined}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // Focusable only programmatically: the container takes focus while the
      // menu has no items yet, so Escape always has somewhere to bubble from
      // (see the focus effect above). Never a tab stop of its own.
      tabIndex={-1}
      style={style}
    >
      {header}
      {flat.length === 0 ? (
        <EmptyState layout="fill">{emptyLabel}</EmptyState>
      ) : (
        groups.map(([group, bucket]) => (
          <div key={group}>
            {/* A single ungrouped bucket renders flat: a lone header naming
                every item in the menu is noise, not structure. */}
            {groups.length > 1 ? <GroupHeader>{group}</GroupHeader> : null}
            {bucket.map((item) => {
              const index = flat.indexOf(item);
              return (
                <MenuItem
                  key={item.key}
                  type="button"
                  role="menuitem"
                  aria-label={item.ariaLabel}
                  // aria-disabled, NOT the native `disabled` attribute: a
                  // natively-disabled button cannot receive focus, so it would
                  // drop out of the arrow-key walk and read as missing rather
                  // than unavailable. Activation is refused in onClick instead,
                  // which is what APG's focusable-disabled guidance asks for.
                  aria-disabled={item.disabled}
                  $disabled={item.disabled}
                  // Roving tabindex: exactly one item is in the tab order.
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
  border-radius: var(--radius-sm, 3px);
  padding: var(--space-4, 4px) 0;
  /* The popover-anchored-to-a-control rung, the same one ComboboxListbox's
     Dropdown takes and for the same reason. */
  z-index: var(--z-dropdown, 200);
`;

const GroupHeader = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  padding: var(--space-8, 8px) var(--space-8, 8px) var(--space-4, 4px);
`;

const MenuItem = styled.button<{ $disabled?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  font-size: var(--font-size-xs);
  padding: var(--space-6, 6px) var(--space-8, 8px);
  cursor: pointer;

  &:hover[aria-disabled="false"],
  &:hover:not([aria-disabled]) {
    background: var(--color-border-subtle);
  }

  /* An INSET ring, not the usual outset one. A menu item is full-width inside a
     scroll box, so an outward 2px offset has nowhere to go left or right: both
     vertical edges are clipped and the ring reads as two loose horizontal bars
     rather than as a ring around the focused item. Drawing it inside the item's
     own box keeps all four edges, and the background swap makes the focused row
     legible as a row even where the ring meets the menu border. */
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
    background: var(--color-border-subtle);
  }

  &[aria-disabled="true"] {
    color: var(--color-text-faint);
    cursor: default;
  }
`;
