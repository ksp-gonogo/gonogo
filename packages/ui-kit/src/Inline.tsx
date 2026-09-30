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
   * Gap between children, as a gap job. Omitted, it is `--gap-related`,
   * inherited from the container, so the cluster takes a panel's or a card's
   * density. Pass one only from a container deciding its own spacing.
   */
  gap?: GapToken;
  /**
   * Adds `margin-left: 6px` so this cluster sits apart from a preceding
   * sibling cluster (e.g. a badge row followed by an action-button row).
   */
  inset?: boolean;
  /**
   * Lets the cluster break onto further lines instead of staying one
   * unbreakable run, and drops the `flex-shrink: 0` that would otherwise stop
   * it ever being narrow enough to need to.
   *
   * Turn this on wherever the number of children is data-driven, since an
   * unbreakable cluster runs on past a narrow column.
   */
  wrap?: boolean;
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
