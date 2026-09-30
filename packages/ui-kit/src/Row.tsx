import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { focusRingInset } from "./focusRing";
import { statusFill } from "./tone";

/**
 * Props for {@link Row}. Any other HTML attribute passes through to the
 * rendered element.
 *
 * @category Layout
 */
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

/**
 * The name inside a {@link Row}: fills the free width and truncates with an
 * ellipsis. Also reachable as `Row.Name`.
 *
 * @category Layout
 */
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
  ${statusFill("go")}

  &:hover {
    background: var(--color-go-status);
  }
`
      : ""}
  /* After the interactive block, whose padding shorthand would reset it. */
  ${({ $nested }) => ($nested ? "padding-left: var(--indent-row);" : "")}
`;

/**
 * One list row with its children spread between the edges: the name on the
 * left in a {@link RowName}, badges and actions on the right. Renders an `li`
 * by default, so it belongs in a plain `ul`. Set `interactive` with
 * `as="button"` for a selectable row.
 *
 * @example
 * ```tsx
 * <ul>
 *   {vessels.map((v) => (
 *     <Row key={v.id}>
 *       <Row.Name>{v.name}</Row.Name>
 *       <Inline>
 *         <Badge tone="go">{v.situation}</Badge>
 *       </Inline>
 *     </Row>
 *   ))}
 * </ul>
 * ```
 *
 * @category Layout
 */
export const Row = Object.assign(RowBase, { Name: RowName });
