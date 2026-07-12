import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export type ClusterJustify = "between" | "start" | "end";

export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  /** `justify-content` shorthand. Defaults to `between`. */
  justify?: ClusterJustify;
  /** Gap between children, snapped to the space scale. Defaults to `md`. */
  gap?: SpaceToken;
  children?: ReactNode;
}

const JUSTIFY_CONTENT: Record<ClusterJustify, string> = {
  between: "space-between",
  start: "flex-start",
  end: "flex-end",
};

/**
 * The single most-repeated block in the dashboard: a horizontal row with
 * centred items, spread-out justification, and a `min-width: 0` so a
 * truncating child inside actually truncates instead of overflowing the flex
 * item. Verbatim source: ScienceOfficer's `TitleRow` and `LabHeader`.
 */
export function Cluster({
  justify = "between",
  gap = "md",
  children,
  ...rest
}: ClusterProps) {
  return (
    <Cluster__Root $justify={justify} $gap={gap} {...rest}>
      {children}
    </Cluster__Root>
  );
}

const Cluster__Root = styled.div<{
  $justify: ClusterJustify;
  $gap: SpaceToken;
}>`
  display: flex;
  align-items: center;
  justify-content: ${({ $justify }) => JUSTIFY_CONTENT[$justify]};
  gap: ${({ theme, $gap }) => theme.space[$gap]};
  min-width: 0;
`;
