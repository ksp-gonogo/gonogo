import type { AnyBoundCommand } from "@ksp-gonogo/sitrep-sdk";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { groupComboboxOptions } from "./Combobox";
import { useBoundCommandInput } from "./CommandButton/commandInput";
import { COMMAND_WORD_ROOM, commandEdge } from "./commandEdge";
import { EmptyState } from "./EmptyState";
import { focusRingInset } from "./focusRing";
import { LiveRegion } from "./LiveRegion";
import { Tooltip } from "./Tooltip";

/**
 * One action in an {@link ActionMenu}. Taken in the menu's `items`.
 * Useful for naming each command the operator can fire from a menu, with its
 * grouping and whether it is currently available. Used by {@link ActionMenu}.
 *
 * @category Floating
 */
export interface ActionMenuItem {
  /** Stable id handed back to `onSelect`. */
  key: string;
  /** The item's visible text, and its accessible name unless `aria-label` is set. */
  label: string;
  /** Optional grouping header; ungrouped items collapse into one flat list. */
  group?: string;
  /** Present but not currently firable: rendered dimmed and inert, still reachable. */
  disabled?: boolean;
  /** Overrides the accessible name when `label` alone is ambiguous out of context. */
  "aria-label"?: string;
  /**
   * The command choosing this item sends, made with `with` on a `useCommand`
   * handle. The item then shows what became of it in a word at its end, and
   * `onSelect` is called when the choice is made so the caller can close the
   * menu: at once where the command is on a delay rail that carries its
   * outcome, else when the press has been answered.
   */
  command?: AnyBoundCommand;
  /** Why a command item cannot be chosen now. It is drawn dimmed with this as its tip and a choice sends nothing. */
  unavailable?: string;
  /** The word the item shows after the first choice, which asks for a second to send. Absent, the first choice sends. */
  confirmLabel?: string;
}

/**
 * Props for {@link ActionMenu}: the actions, the handlers for choosing one or
 * dismissing the menu, and the menu's accessible name.
 * Useful for giving a menu its commands and its dismissal behaviour in one
 * place. Used by {@link ActionMenu}.
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
  "aria-label": string;
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
 * A menu of actions to fire, following the APG `menu` pattern
 * (https://www.w3.org/WAI/ARIA/apg/patterns/menu/). Useful for offering the
 * operator a short list of commands for one target. Used by the part action
 * menu in the ship map.
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
 *       aria-label="Parachute actions"
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
  "aria-label": ariaLabel,
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
              if (item.command) {
                return (
                  <CommandedMenuItem
                    key={item.key}
                    item={item}
                    command={item.command}
                    tabIndex={index === activeIndex ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onSelect={onSelect}
                  />
                );
              }
              return (
                <MenuItem
                  key={item.key}
                  type="button"
                  role="menuitem"
                  aria-label={item["aria-label"]}
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

/* A command item holds the menu's choice until the command has gone, so an outcome never lands on a menu that has closed. */
function CommandedMenuItem({
  item,
  command,
  tabIndex,
  onFocus,
  onSelect,
}: {
  item: ActionMenuItem;
  command: AnyBoundCommand;
  tabIndex: number;
  onFocus: () => void;
  onSelect: (key: string) => void;
}) {
  const input = useBoundCommandInput({
    command,
    unavailable: item.unavailable,
  });
  const { control } = input;
  const pending = useRef(false);
  const railed = control.command.handle.railed === true;
  const armable = item.confirmLabel !== undefined;
  // A command with no rail keeps the menu open until the mod answers it.
  useEffect(() => {
    if (pending.current && !railed && !control.isSent) {
      pending.current = false;
      onSelect(item.key);
    }
  }, [control.isSent, railed, onSelect, item.key]);
  const word = input.word ?? (control.isArmed ? item.confirmLabel : null);
  return (
    <>
      <Tooltip text={input.tip}>
        <MenuItem
          type="button"
          role="menuitem"
          aria-label={item["aria-label"]}
          aria-disabled={item.disabled || input.inert || undefined}
          $disabled={item.disabled || input.inert}
          tabIndex={tabIndex}
          onFocus={onFocus}
          data-command-edge={input.edge["data-command-edge"]}
          data-command-phase={input.edge["data-command-phase"]}
          data-stream={input.edge["data-stream"]}
          data-predicted={input.edge["data-predicted"]}
          onClick={() => {
            if (item.disabled || input.inert) return;
            const wasArmed = control.isArmed;
            control.press(armable);
            if (armable && !wasArmed) return;
            if (railed) onSelect(item.key);
            else pending.current = true;
          }}
        >
          <MenuItemLabel>{item.label}</MenuItemLabel>
          <MenuItemWord aria-hidden="true">{word}</MenuItemWord>
        </MenuItem>
      </Tooltip>
      <LiveRegion visuallyHidden>{input.announce}</LiveRegion>
    </>
  );
}

const MenuItemLabel = styled.span`
  flex: 1;
`;

/* Holds the room of the longest word at rest too, so the menu never changes width. */
const MenuItemWord = styled.span`
  min-width: ${COMMAND_WORD_ROOM};
  text-align: end;
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
`;

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
  /* A border of its own, clear at rest, so the state edges of a command are drawn on the item's box as on every other input. */
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  width: 100%;
  text-align: left;
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

  ${commandEdge}

  @media (pointer: coarse) {
    min-height: var(--touch-target);
  }
`;
