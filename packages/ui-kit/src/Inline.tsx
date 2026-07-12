import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export interface InlineProps extends HTMLAttributes<HTMLSpanElement> {
  /** Gap between children, snapped to the space scale. Defaults to `sm`. */
  gap?: SpaceToken;
  /**
   * Adds `margin-left: 6px` so this cluster sits apart from a preceding
   * sibling cluster (e.g. a badge row followed by an action-button row).
   * Verbatim source: ScienceOfficer's `Actions` (vs. plain `Badges`).
   */
  inset?: boolean;
  children?: ReactNode;
}

/**
 * Compact inline cluster for badges/action buttons that must not grow —
 * `flex-shrink: 0` so it never yields space to a truncating sibling.
 * Replaces ScienceOfficer's `Badges`/`LabBadges`/`Actions`.
 */
export function Inline({
  gap = "sm",
  inset = false,
  children,
  ...rest
}: InlineProps) {
  return (
    <Inline__Root $gap={gap} $inset={inset} {...rest}>
      {children}
    </Inline__Root>
  );
}

const Inline__Root = styled.span<{ $gap: SpaceToken; $inset: boolean }>`
  display: inline-flex;
  gap: ${({ theme, $gap }) => theme.space[$gap]};
  flex-shrink: 0;
  ${({ $inset }) => $inset && `margin-left: 6px;`}
`;
