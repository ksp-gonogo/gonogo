import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export interface RowProps extends HTMLAttributes<HTMLElement> {
  /** Rendered tag. Defaults to `li` (a `Row` typically sits in a plain `<ul>`). */
  as?: ElementType;
  /**
   * Makes the row a control: pointer cursor, a hover background, and a real
   * `:focus-visible` ring. Pair it with `as="button"`, which is what a
   * selectable row must be so it is reachable by keyboard.
   *
   * It exists because a picker row is a genuinely common shape and the kit had
   * only a non-interactive `li`, so `TargetPicker` kept its own `styled.button`
   * with its own focus ring. A third-party Uplink building a picker would have
   * had to do the same.
   */
  interactive?: boolean;
  /** Current selection, for an `interactive` row. */
  selected?: boolean;
  /**
   * Button type, for `as="button"`. Declared because an interactive row IS a
   * button and a bare `<button>` inside a form defaults to `submit`, which is
   * the classic way a picker click reloads the page.
   */
  type?: "button" | "submit" | "reset";
  /** Disabled, for `as="button"`. */
  disabled?: boolean;
  /**
   * Lets the trailing clusters drop to a second line when they cannot share
   * one with a readable name, and gives `RowName` a minimum readable width so
   * that they actually do.
   *
   * Both halves are needed, which is why this is one prop and not two. A
   * `RowName` is `flex: 1 1 0`, so it yields all of its width before anything
   * else gives up any: the line never overflows, `flex-wrap` never engages, and
   * what an operator gets is a full set of badges beside a name shaved to a
   * single glyph. That is what a crowded four-badge row was doing, and at a
   * narrow grid column the badges then ran on past the row entirely and painted
   * over the neighbouring column's text.
   *
   * Off by default, on Cluster's reasoning: a row that wraps silently is how a
   * tidy list becomes a ragged block at a narrow width without anyone noticing.
   */
  wrap?: boolean;
  /**
   * Marks the row SUBORDINATE to the one above it, and insets it to say so.
   *
   * <para>One relationship, three names: an "of which" line under a total, a
   * child under a tree node, a sub-total under its group. All of them are "this
   * row belongs to the one above", and the kit should draw that once rather than
   * have each caller invent an inset.</para>
   *
   * <para><b>Left only</b>, because the right side of an indent communicates
   * nothing. The obvious alternative is a padded wrapper and ui-kit's `Box` pads
   * both sides, which spends width on a margin no reader can interpret.</para>
   *
   * <para><b>What that is NOT worth, measured, because the first version of this
   * comment claimed otherwise.</b> On Vehicle Assembly's cost breakdown the
   * subordinate label was two pixels short at the widget's minimum size, and the
   * right-hand pad was blamed. It was not the cause: at equal inset the two
   * approaches leave identical room, and with NO inset the label fits exactly. The
   * row simply has no spare width there, so any indent at all costs it. Left-only
   * is still right, and it did not buy the pixels it was predicted to.</para>
   *
   * <para>The inset is a token rather than a depth multiplier, and it is sized for
   * the design system rather than for the narrowest caller: a legible indent at the
   * sizes a row is read at beats a smaller one chosen to lose by less where it was
   * always going to lose. Nothing nests twice yet, and a `depth` prop with no
   * second level to justify it is API invented ahead of a use.</para>
   */
  nested?: boolean;
  children?: ReactNode;
}

/**
 * A single spaced-between list row: name on the left, badges/actions on the
 * right. Extracted from ScienceOfficer's `Row` (`styled.li`): the shape
 * hand-rolled ten times across the built-in widgets.
 *
 * The truncating name child is exported alongside as `RowName` (also
 * reachable as `Row.Name`).
 */
function RowBase({
  as,
  interactive = false,
  selected = false,
  wrap = false,
  nested = false,
  children,
  ...rest
}: RowProps) {
  return (
    <Row__Root
      as={as ?? "li"}
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
 * How much of the name a wrapping row refuses to give up. Twelve characters is
 * enough to tell "Mystery Goo™ ..." from "PresMat Baro...", and the `min()` keeps
 * it from overflowing a row narrower than that.
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
  gap: var(--space-8, 8px);
  font-size: var(--font-size-sm);
  padding: var(--space-2, 2px) 0;
  ${({ $nested }) => ($nested ? `padding-left: var(--space-12, 12px);` : "")}
  ${({ $wrap }) =>
    $wrap
      ? `
  flex-wrap: wrap;
  row-gap: var(--space-4, 4px);

  & > ${RowName} {
    min-width: ${WRAPPED_NAME_FLOOR};
  }
`
      : ""}
  ${({ $interactive }) =>
    $interactive
      ? `
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  padding: var(--space-4, 4px) var(--space-6, 6px);
  border-radius: var(--radius-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;

  &:hover {
    background: var(--color-surface-panel);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`
      : ""}
  ${({ $interactive, $selected }) =>
    $interactive && $selected
      ? `
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);

  &:hover {
    background: var(--color-status-go-bg);
  }
`
      : ""}
`;

export const Row = Object.assign(RowBase, { Name: RowName });
