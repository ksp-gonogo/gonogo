import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { SPACE_VAR, type SpaceToken } from "./scales";

export interface InlineProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Gap between children, snapped to the space scale. Omit it and the gap is
   * `--gap-related`, inherited from whichever container the cluster lands in,
   * so the same cluster is 8px on a panel and 6px inside a card. Pass a size
   * only from a container deciding the spacing for what it holds.
   */
  gap?: SpaceToken;
  /**
   * Adds `margin-left: 6px` so this cluster sits apart from a preceding
   * sibling cluster (e.g. a badge row followed by an action-button row).
   * Verbatim source: ScienceOfficer's `Actions` (vs. plain `Badges`).
   */
  inset?: boolean;
  /**
   * Lets the cluster break onto further lines instead of staying one
   * unbreakable run, and drops the `flex-shrink: 0` that would otherwise stop
   * it ever being narrow enough to need to.
   *
   * "Must not grow" is the right contract for two badges and the wrong one for
   * six: a full badge set is wider than a narrow column, and an unbreakable
   * cluster that will not shrink does not stop at the column edge, it carries
   * on across whatever is drawn beside it. Turn this on wherever the number of
   * children is data-driven rather than fixed.
   */
  wrap?: boolean;
  children?: ReactNode;
}

/**
 * Compact inline cluster for badges/action buttons that must not grow,
 * `flex-shrink: 0` so it never yields space to a truncating sibling.
 * Replaces ScienceOfficer's `Badges`/`LabBadges`/`Actions`.
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
  $gap?: SpaceToken;
  $inset: boolean;
  $wrap: boolean;
}>`
  display: inline-flex;
  gap: ${({ $gap }) =>
    $gap ? SPACE_VAR[$gap] : "var(--gap-related, var(--space-8, 8px))"};
  flex-shrink: ${({ $wrap }) => ($wrap ? 1 : 0)};
  ${({ $wrap }) => $wrap && `flex-wrap: wrap; min-width: 0;`}
  ${({ $inset }) => $inset && `margin-left: var(--space-6, 6px);`}
`;
