import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Vertical alignment of the cells in a {@link Grid} row.
 *
 * @category Layout
 */
export type GridAlign = "center" | "start" | "baseline" | "stretch";

/**
 * Props for {@link Grid}. Any other `div` attribute passes through.
 *
 * @category Layout
 */
export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `align-items` shorthand. Defaults to `center`; `baseline` is what a
   * label/value grid wants, so a caption and a larger value share a baseline;
   * `stretch` makes every cell in a row as tall as the tallest.
   */
  align?: GridAlign;
  /**
   * Fixed column template (e.g. `"120px 1fr 60px"`). Takes precedence over
   * `minColWidth` when both are set.
   */
  cols?: string;
  /**
   * Responsive columns: as many equal columns of at least this width as fit
   * (`repeat(auto-fill, minmax(min(minColWidth, 100%), 1fr))`). A container
   * narrower than `minColWidth` gets one column of its own width rather than
   * overflowing. Ignored when `cols` is set.
   */
  minColWidth?: string;
  /**
   * Auto-fit rather than auto-fill the `minColWidth` columns: a row with fewer
   * cells than columns stretches them across the row instead of leaving empty
   * tracks beside them. Only meaningful with `minColWidth`.
   */
  fit?: boolean;
  /** Gap between cells, one of the {@link GapToken} names. Defaults to `related-dense`. */
  gap?: GapToken;
  /**
   * Row gap, when it differs from the column gap: a label/value grid usually
   * wants its rows tighter than its columns.
   */
  rowGap?: GapToken;
  children?: ReactNode;
}

const ALIGN_ITEMS: Record<GridAlign, string> = {
  center: "center",
  start: "start",
  baseline: "baseline",
  stretch: "stretch",
};

/**
 * A CSS grid, either with a fixed column template (`cols`) or with as many
 * equal columns of at least `minColWidth` as fit. With neither it is a single
 * column.
 *
 * @category Layout
 */
export function Grid({
  cols,
  minColWidth,
  fit = false,
  gap = "related-dense",
  rowGap,
  align = "center",
  children,
  ...rest
}: GridProps) {
  return (
    <Grid__Root
      $cols={cols}
      $minColWidth={minColWidth}
      $fit={fit}
      $gap={gap}
      $rowGap={rowGap}
      $align={align}
      {...rest}
    >
      {children}
    </Grid__Root>
  );
}

const Grid__Root = styled.div<{
  $cols?: string;
  $minColWidth?: string;
  $fit: boolean;
  $gap: GapToken;
  $rowGap?: GapToken;
  $align: GridAlign;
}>`
  display: grid;
  align-items: ${({ $align }) => ALIGN_ITEMS[$align]};
  gap: ${({ $gap, $rowGap }) =>
    $rowGap ? `${GAP_VAR[$rowGap]} ${GAP_VAR[$gap]}` : GAP_VAR[$gap]};
  grid-template-columns: ${({ $cols, $minColWidth, $fit }) => {
    if ($cols) return $cols;
    if ($minColWidth)
      return `repeat(${$fit ? "auto-fit" : "auto-fill"}, minmax(min(${$minColWidth}, 100%), 1fr))`;
    return "1fr";
  }};
`;
