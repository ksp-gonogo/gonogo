import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

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
 * Compact inline cluster for badges and action buttons that must not grow,
 * `flex-shrink: 0` so it never yields space to a truncating sibling.
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
