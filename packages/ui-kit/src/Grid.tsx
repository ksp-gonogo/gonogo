import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export type GridAlign = "center" | "start" | "baseline";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `align-items` shorthand. Defaults to `center`, matching Cluster, and
   * `baseline` is what a label/value grid actually wants: a caption and a
   * larger value sit on the same text baseline rather than being centred
   * against each other. Added when two sites (SystemView's almanac and
   * CommSignal) both turned out to need it.
   */
  align?: GridAlign;
  /**
   * Fixed column template (e.g. `"120px 1fr 60px"`). Takes precedence over
   * `minColWidth` when both are set. Extracted from the Scanning widget's
   * coverage row (`grid-template-columns: 120px 1fr 60px`).
   */
  cols?: string;
  /**
   * Auto-fill responsive columns: `repeat(auto-fill, minmax(minColWidth, 1fr))`.
   * Ignored when `cols` is set.
   */
  minColWidth?: string;
  /** Gap between cells, snapped to the space scale. Defaults to `sm`. */
  gap?: SpaceToken;
  /**
   * Row gap, when it differs from the column gap. A label/value grid usually
   * wants its rows tighter than its columns, and `gap` alone forces one value
   * on both axes; CommSignal was keeping its own grid for exactly that.
   */
  rowGap?: SpaceToken;
  children?: ReactNode;
}

/**
 * CSS grid wrapper for fixed-column rows and auto-fill card layouts, the two
 * grid shapes widgets hand-roll (a labelled data row, a responsive card
 * gallery).
 */
const ALIGN_ITEMS: Record<GridAlign, string> = {
  center: "center",
  start: "start",
  baseline: "baseline",
};

export function Grid({
  cols,
  minColWidth,
  gap = "sm",
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
  $gap: SpaceToken;
  $rowGap?: SpaceToken;
  $align: GridAlign;
}>`
  display: grid;
  align-items: ${({ $align }) => ALIGN_ITEMS[$align]};
  gap: ${({ theme, $gap, $rowGap }) =>
    $rowGap
      ? `${theme.space[$rowGap]} ${theme.space[$gap]}`
      : theme.space[$gap]};
  grid-template-columns: ${({ $cols, $minColWidth }) => {
    if ($cols) return $cols;
    if ($minColWidth) return `repeat(auto-fill, minmax(${$minColWidth}, 1fr))`;
    return "1fr";
  }};
`;
