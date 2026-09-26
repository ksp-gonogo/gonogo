import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { RADIUS_VAR } from "./scales";

export type GraphNoticePlacement = "overlay" | "inline";

export interface GraphNoticeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /**
   * `overlay` pins the pill to the bottom-left corner over the graph (pair with
   * a `position: relative` ancestor such as `Fill`). `inline` sits as a flow
   * row below the graph, where an overlay would cover the x-axis labels.
   */
  placement: GraphNoticePlacement;
}

const PLACEMENT_STYLES = {
  overlay: css`
    position: absolute;
    bottom: var(--offset-graph-notice-bottom);
    left: var(--offset-graph-notice-left);
  `,
  inline: css`
    flex: 0 0 auto;
    align-self: flex-start;
    max-width: 100%;
    margin-top: var(--gap-sub-readout);
  `,
} as const;

/**
 * Faint degraded-state pill for a graph widget ("no reference data",
 * "unknown body"). `pointer-events: none`, so it never intercepts the graph's
 * clicks. `role="status"` by default; override via `role`.
 */
export function GraphNotice({
  placement,
  role = "status",
  children,
  ...rest
}: GraphNoticeProps) {
  return (
    <GraphNotice__Root $placement={placement} role={role} {...rest}>
      {children}
    </GraphNotice__Root>
  );
}

const GraphNotice__Root = styled.div<{ $placement: GraphNoticePlacement }>`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  /* No surface token is translucent, so this scrim stays a raw value. */
  background: rgba(0, 0, 0, 0.7);
  padding: var(--inset-notice-pill);
  border-radius: ${RADIUS_VAR.regular};
  pointer-events: none;

  ${({ $placement }) => PLACEMENT_STYLES[$placement]}
`;
