import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { focusRingInset } from "./focusRing";

export interface RowProps extends HTMLAttributes<HTMLElement> {
  /** Rendered tag. Defaults to `li` (a `Row` typically sits in a plain `<ul>`). */
  as?: ElementType;
  /**
   * Makes the row a control: pointer cursor, a hover background, and a real
   * `:focus-visible` ring. Pair it with `as="button"`, which is what a
   * selectable row must be so it is reachable by keyboard.
   */
  interactive?: boolean;
  /** Current selection, for an `interactive` row. */
  selected?: boolean;
  /**
   * Button type, for `as="button"`: a bare `<button>` inside a form defaults to
   * `submit`.
   */
  type?: "button" | "submit" | "reset";
  /** Disabled, for `as="button"`. */
  disabled?: boolean;
  /**
   * Lets the trailing clusters drop to a second line when they cannot share
   * one with a readable name, and gives `RowName` a minimum readable width so
   * that they actually do: without the floor the name yields all its width and
   * the line never wraps. Off by default, so a list never turns ragged silently.
   */
  wrap?: boolean;
  /**
   * Marks the row subordinate to the one above it (an "of which" line under a
   * total, a child under a tree node) and insets it on the left only, since the
   * right side of an indent communicates nothing. One level, one token.
   */
  nested?: boolean;
  children?: ReactNode;
}

/**
 * A single spaced-between list row: name on the left, badges and actions on
 * the right. The truncating name child is `RowName` (also `Row.Name`).
 */
function RowBase({
  as,
  interactive = false,
  selected = false,
  wrap = false,
  nested = false,
  type,
  children,
  ...rest
}: RowProps) {
  return (
    <Row__Root
      as={as ?? "li"}
      type={type ?? (as === "button" ? "button" : undefined)}
      $interactive={interactive}
      $selected={selected}
      $wrap={wrap}
      $nested={nested}
      {...rest}
    >
      {children}
    </Row__Root>
  );
}

/** Truncating name/label child for a `Row`: flexes to fill, ellipsises overflow. */
export const RowName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
`;

/**
 * How much of the name a wrapping row refuses to give up; the `min()` keeps it
 * from overflowing a narrower row.
 */
const WRAPPED_NAME_FLOOR = "min(12ch, 100%)";

const Row__Root = styled.li<{
  $interactive: boolean;
  $selected: boolean;
  $wrap: boolean;
  $nested: boolean;
}>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-row);
  font-size: var(--font-size-compact);
  padding: var(--inset-row);
  ${({ $wrap }) =>
    $wrap
      ? `
  flex-wrap: wrap;
  row-gap: var(--gap-row-wrap);

  & > ${RowName} {
    min-width: ${WRAPPED_NAME_FLOOR};
  }
`
      : ""}
  ${({ $interactive }) =>
    $interactive
      ? css`
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  padding: var(--inset-row-pressable);
  border-radius: var(--radius-regular);
  cursor: pointer;
  text-align: left;
  font-family: inherit;

  &:hover {
    background: var(--color-surface-panel);
  }

  ${focusRingInset}
`
      : ""}
  ${({ $interactive, $selected }) =>
    $interactive && $selected
      ? `
  background: var(--color-go-status);
  color: var(--color-go-on-status);
  /* Secondary words inside the row sit on the go fill too, so they take its text rather than a grey made for the panel. */
  --color-text-muted: var(--color-go-on-status);
  --color-text-faint: var(--color-go-on-status);

  &:hover {
    background: var(--color-go-status);
  }
`
      : ""}
  /* After the interactive block, whose padding shorthand would reset it. */
  ${({ $nested }) => ($nested ? "padding-left: var(--indent-row);" : "")}
`;

export const Row = Object.assign(RowBase, { Name: RowName });
