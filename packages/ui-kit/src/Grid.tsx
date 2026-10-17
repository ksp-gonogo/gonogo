import { Children, type HTMLAttributes, type ReactNode } from "react";
import styled from "styled-components";
import { squareAreaRules, squareGridRules } from "./gridSquares";
import { ScrollArea } from "./Panel";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Vertical alignment of the cells in a {@link Grid} row.
 * Useful for lining up cards or readouts of different heights in one row.
 *
 * @category Layout
 */
export type GridAlign = "center" | "start" | "baseline" | "stretch";

/**
 * Props for {@link Grid}. Any other `div` attribute passes through.
 * Useful for laying out cards or readouts that reflow with the width of the
 * panel. Used by {@link Grid}.
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
  /**
   * Lay the cells out to hold equal squares in the height the grid is given,
   * rather than in rows of their own height. The grid takes its height from
   * its container as a flex or grid item with room to grow, and picks as many
   * columns as draws the squares largest: a tall grid stacks its cells, a wide
   * one sets them in a row. `minColWidth` (default `120px`) is the narrowest
   * column while the grid has the height to draw squares that wide, and the
   * smallest square it shrinks to before asking for more height and letting
   * its container scroll. Inside a size container (`container-type: size`,
   * such as the content of a scroller) it grows to that container's height and
   * no further, and no square is taller than it; a container that sizes the
   * grid itself sets `--grid-squares-height` on an ancestor to replace the
   * height it asks for. Each cell is a size container, so a child draws its
   * square with `min(100cqw, 100cqh)`, less any heading band. `cols` and `fit`
   * are ignored.
   */
  squares?: boolean;
  /**
   * With `squares`, the height in px of a band above each square, such as a
   * heading, which the column choice allows for. Defaults to `0`.
   */
  squareHeadingPx?: number;
  /**
   * With `squares`, the cells fill the grid instead of staying square, and a
   * row shrinks to this height (a px figure) before the grid asks for more
   * height. The column count still follows the shape of the grid, and the
   * grid takes the room its flex container leaves rather than a size
   * container's height. Once the rows no longer fit at this height the grid
   * scrolls inside its own {@link ScrollArea}, which draws the edge glow, and
   * it never shrinks below one row of that height. Without `minRowHeight` the
   * grid has no scroller of its own. Useful for cells that hold a line or two
   * of text, such as a station's name and state, rather than a drawing.
   */
  minRowHeight?: string;
  /** The cells, filled in reading order. */
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
 * column. With `squares` it fills the height it is given with equal square
 * cells instead. Useful for laying out cards or readouts that should reflow
 * with the width of the panel, or drawings that should share a scale and fill
 * the tile. Used by the comm signal and docking HUD widgets, by a landing
 * widget's plots, and by the GO/NO-GO board's stations.
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
  squares = false,
  squareHeadingPx = 0,
  minRowHeight,
  children,
  ...rest
}: GridProps) {
  if (squares) {
    const count = Children.toArray(children).length;
    const min = minColWidth ?? "120px";
    const area = (
      <Grid__SquaresArea
        $count={count}
        $min={min}
        $headingPx={squareHeadingPx}
        $gap={GAP_VAR[gap]}
        $rowMin={minRowHeight}
      >
        <Grid__Squares
          $count={count}
          $min={min}
          $headingPx={squareHeadingPx}
          $gap={GAP_VAR[gap]}
          $rowMin={minRowHeight}
          data-grid-squares=""
        >
          {children}
        </Grid__Squares>
      </Grid__SquaresArea>
    );
    return (
      <Grid__SquaresWidth $rowMin={minRowHeight} {...rest}>
        {minRowHeight === undefined ? (
          area
        ) : (
          <Grid__Scroll>{area}</Grid__Scroll>
        )}
      </Grid__SquaresWidth>
    );
  }
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

const Grid__SquaresWidth = styled.div<{ $rowMin?: string }>`
  container: grid-squares-width / inline-size;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  ${({ $rowMin }) =>
    $rowMin &&
    `
  flex-basis: 0;
  min-height: ${$rowMin};
`}
`;

/*
 * The area stays a flex child of the scroller's inner element, so it grows to
 * the room there is and overflows into a scroll only once its rows reach their
 * floor.
 */
const Grid__Scroll = styled(ScrollArea)`
  & > [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
  }
`;

const Grid__SquaresArea = styled.div<{
  $count: number;
  $min: string;
  $headingPx: number;
  $gap: string;
  $rowMin?: string;
}>`
  container: grid-squares / size;
  flex: 1 1 auto;
  ${({ $count, $min, $headingPx, $gap, $rowMin }) =>
    squareAreaRules($count, $min, $headingPx, $gap, $rowMin)}
`;

const Grid__Squares = styled.div<{
  $count: number;
  $min: string;
  $headingPx: number;
  $gap: string;
  $rowMin?: string;
}>`
  --cols: 1;
  --rows: ${({ $count }) => $count};
  display: grid;
  height: 100%;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
  gap: ${({ $gap }) => $gap};
  ${({ $count, $min, $headingPx, $rowMin }) =>
    squareGridRules($count, $min, $headingPx, $rowMin)}
  & > * {
    container-type: size;
    min-width: 0;
    min-height: 0;
  }
`;
