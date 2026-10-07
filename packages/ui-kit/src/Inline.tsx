import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Props for {@link Inline}. Any other `span` attribute passes through.
 *
 * @category Layout
 */
export interface InlineProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Gap between children, one of the {@link GapToken} names. Omitted, it is
   * the `related` gap of whatever container the run sits in, so it matches a
   * panel's or a card's spacing. Set it only where this run decides its own
   * spacing.
   */
  gap?: GapToken;
  /**
   * Adds `margin-left: 6px` so this run sits apart from a preceding sibling
   * run (e.g. a badge row followed by an action-button row).
   */
  inset?: boolean;
  /**
   * Lets the run break onto further lines and shrink with its container.
   * Without it the run stays on one line at its full width.
   *
   * Turn this on wherever the number of children comes from data, since a run
   * that cannot break overflows a narrow column.
   */
  wrap?: boolean;
  /** The runs of text and inline items, laid out in a line. */
  children?: ReactNode;
}

/**
 * A compact inline-flex `span` for a run of badges or action buttons. It does
 * not shrink (`flex-shrink: 0`), so a truncating sibling gives up space before
 * it does; set `wrap` when the number of children depends on data.
 *
 * @category Layout
 */
export function Inline({
  gap,
  inset = false,
  wrap = false,
  children,
  ...rest
}: InlineProps) {
  return (
    <Inline__Root $gap={gap} $inset={inset} $wrap={wrap} {...rest}>
      {children}
    </Inline__Root>
  );
}

const Inline__Root = styled.span<{
  $gap?: GapToken;
  $inset: boolean;
  $wrap: boolean;
}>`
  display: inline-flex;
  gap: ${({ $gap }) => ($gap ? GAP_VAR[$gap] : "var(--gap-related)")};
  flex-shrink: ${({ $wrap }) => ($wrap ? 1 : 0)};
  ${({ $wrap }) => $wrap && `flex-wrap: wrap; min-width: 0;`}
  ${({ $inset }) => $inset && `margin-left: var(--gap-inline-cluster);`}
`;
