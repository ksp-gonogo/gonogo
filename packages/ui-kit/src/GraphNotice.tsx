import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { RADIUS_VAR } from "./scales";

/**
 * Where a {@link GraphNotice} sits relative to its graph: `"overlay"` over the
 * graph's bottom-left corner, `"center"` over its middle, `"inline"` as a row
 * below it, `"beside"` as a column to its right. Useful for keeping a notice
 * from covering what the operator is reading on the graph. Returned by
 * {@link placeGraphNotice} and taken by {@link GraphNotice}.
 *
 * @category LineGraph
 */
export type GraphNoticePlacement = "overlay" | "center" | "inline" | "beside";

/**
 * The measured space a graph and its notice share, and whether the plot draws
 * anything a notice could cover. Useful for choosing where a notice sits
 * without hiding the operator's data. Taken by {@link placeGraphNotice}.
 *
 * @category LineGraph
 */
export interface GraphNoticeSpace {
  /** Width of the area the graph and its notice share, in CSS pixels. */
  width: number;
  /** Height of that area, in CSS pixels. */
  height: number;
  /** The plot draws a trace, a curve or a layer, so an overlay would sit on data. */
  plotHasData: boolean;
}

/** Smallest empty plot that still has room for a pill laid over it. */
const OVERLAY_MIN = { width: 160, height: 72 } as const;

/** A shared area at least this many times wider than tall puts the notice at the side, where a row below would take a large share of its height. */
const BESIDE_ASPECT = 2.5;

/** Narrowest shared area where a side column leaves the plot a usable width. */
const BESIDE_MIN_WIDTH = 420;

/**
 * The placement for a graph's notice, decided from the measured space the graph
 * and notice share. Useful for keeping a degraded-state message from covering
 * the operator's data. Used by the graph widget.
 *
 * An empty plot with room takes it over its middle, since nothing is underneath
 * to cover. Otherwise it goes beside a wide, short graph, where a row below
 * would cost the plot a large share of its height, and below everything else.
 *
 * @category LineGraph
 */
export function placeGraphNotice({
  width,
  height,
  plotHasData,
}: GraphNoticeSpace): GraphNoticePlacement {
  if (
    !plotHasData &&
    width >= OVERLAY_MIN.width &&
    height >= OVERLAY_MIN.height
  ) {
    return "center";
  }
  if (width >= BESIDE_MIN_WIDTH && width >= height * BESIDE_ASPECT) {
    return "beside";
  }
  return "inline";
}

/**
 * Props for {@link GraphNotice}.
 * Useful for telling the operator why a graph is incomplete. Used by {@link
 * GraphNotice}.
 *
 * @category LineGraph
 */
export interface GraphNoticeProps extends HTMLAttributes<HTMLDivElement> {
  /** The notice's words. */
  children?: ReactNode;
  /**
   * `overlay` pins the pill to the bottom-left corner over the graph (pair with
   * a `position: relative` ancestor); `center` pins it to the
   * middle of that ancestor instead. `inline` sits as a flow
   * row below the graph, where an overlay would cover labels the caller draws
   * under it.
   * `beside` sits as a flex column to its right. {@link placeGraphNotice}
   * picks one from measured space.
   */
  placement: GraphNoticePlacement;
}

const PLACEMENT_STYLES = {
  overlay: css`
    position: absolute;
    bottom: var(--offset-graph-notice-bottom);
    left: var(--offset-graph-notice-left);
  `,
  center: css`
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 90%;
    text-align: center;
  `,
  inline: css`
    flex: 0 0 auto;
    align-self: flex-start;
    max-width: 100%;
    margin-top: var(--gap-sub-readout);
  `,
  beside: css`
    flex: 0 1 30%;
    align-self: flex-start;
    max-width: 40%;
  `,
} as const;

/**
 * A faint degraded-state pill for a graph widget ("no reference data", "unknown
 * body"). Useful for telling the operator why a graph is incomplete without
 * hiding the plot. Used by the graph widget. It sets `pointer-events: none`, so
 * it never intercepts the graph's clicks, and `role="status"` by default;
 * override via `role`.
 *
 * @example Over a graph in a `position: relative` container
 * ```tsx
 * <div style={{ position: "relative" }}>
 *   <Graph series={series} xDomain={[0, 600]} aria-label="Altitude trend" />
 *   {series.length === 0 && (
 *     <GraphNotice placement="overlay">no reference data</GraphNotice>
 *   )}
 * </div>
 * ```
 *
 * @category LineGraph
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
