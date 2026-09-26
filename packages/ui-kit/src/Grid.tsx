import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

export type GridAlign = "center" | "start" | "baseline";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `align-items` shorthand. Defaults to `center`; `baseline` is what a
   * label/value grid wants, so a caption and a larger value share a baseline.
   */
  align?: GridAlign;
  /**
   * Fixed column template (e.g. `"120px 1fr 60px"`). Takes precedence over
   * `minColWidth` when both are set.
   */
  cols?: string;
  /**
   * Auto-fill responsive columns: `repeat(auto-fill, minmax(minColWidth, 1fr))`.
   * Ignored when `cols` is set.
   */
  minColWidth?: string;
  /** Gap between cells, as a gap job. Defaults to `related-dense`. */
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
};

/** CSS grid wrapper for fixed-column rows and auto-fill card layouts. */
export function Grid({
  cols,
  minColWidth,
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
  $gap: GapToken;
  $rowGap?: GapToken;
  $align: GridAlign;
}>`
  display: grid;
  align-items: ${({ $align }) => ALIGN_ITEMS[$align]};
  gap: ${({ $gap, $rowGap }) =>
    $rowGap ? `${GAP_VAR[$rowGap]} ${GAP_VAR[$gap]}` : GAP_VAR[$gap]};
  grid-template-columns: ${({ $cols, $minColWidth }) => {
    if ($cols) return $cols;
    if ($minColWidth) return `repeat(auto-fill, minmax(${$minColWidth}, 1fr))`;
    return "1fr";
  }};
`;
