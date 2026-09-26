import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { RADIUS_VAR } from "./scales";

export type GraphNoticePlacement = "overlay" | "inline";

export interface GraphNoticeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /**
   * `overlay` pins the pill to the bottom-left corner on top of the graph
   * (absolute positioning, pair with a `position: relative` ancestor,
   * e.g. `Fill`). `inline` sits as a normal flow row below the graph
   * instead, for a widget where an overlay would cover the x-axis tick
   * labels at narrow heights.
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
 * "unknown body", ...), extracted from the near-identical `Notice =
 * styled.div` blocks scattered across the Graph-family widgets
 * (OrbitalAscent, KeplerPeriod, and the still-styled-components
 * AtmosphereProfile / EscapeProfile).
 *
 * `pointer-events: none` throughout, the pill is informational only and
 * must never intercept clicks meant for the graph underneath.
 * `role="status"` by default so screen readers announce the degraded
 * state; override via the `role` prop if a caller needs otherwise.
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
  /* No design-system surface token covers this translucent dark scrim ,
     every surface tier in tokens.css is opaque. Kept as the one raw
     value here (flagged in the migration report); promote to a
     --color-scrim token if a second consumer needs the exact value. */
  background: rgba(0, 0, 0, 0.7);
  padding: var(--inset-notice-pill);
  border-radius: ${RADIUS_VAR.regular};
  pointer-events: none;

  ${({ $placement }) => PLACEMENT_STYLES[$placement]}
`;
