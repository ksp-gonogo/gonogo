import { Children, type HTMLAttributes, type ReactNode } from "react";
import styled from "styled-components";

/**
 * Props for {@link SquareGrid}. Any other `div` attribute passes through to
 * its root. Useful for setting how small its squares may get. Taken by
 * {@link SquareGrid}.
 *
 * @category Layout
 */
export interface SquareGridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The narrowest column the grid lays its squares out in while it has the
   * height to draw them that wide. Defaults to `120`.
   */
  minColumnPx?: number;
  /**
   * The smallest square the grid shrinks to before asking its container for
   * more height and letting it scroll. Capped at `minColumnPx`. Defaults to
   * `120`.
   */
  floorPx?: number;
  /**
   * The height of the heading row above each square, in px, which every
   * {@link SquareCell} keeps whether or not it has a heading. Defaults to `0`.
   */
  headingPx?: number;
  /** The cells, each a {@link SquareCell}, filled in reading order. */
  children?: ReactNode;
}

/**
 * Props for {@link SquareCell}. Useful for giving a drawing its heading.
 * Taken by {@link SquareCell}.
 *
 * @category Layout
 */
export interface SquareCellProps {
  /** Drawn above the square, in the row the grid's `headingPx` keeps. */
  heading?: ReactNode;
  /** The drawing, which fills the square. */
  children?: ReactNode;
}

/**
 * The gap token between squares as a px figure, for the container queries,
 * which cannot read a custom property. It moves only the points at which the
 * column count changes.
 */
const GAP_ALLOWANCE_PX = 8;

/**
 * The column counts worth offering `count` squares: one, then each count that
 * saves a row over the one before it. Three squares sit in one, two or three
 * columns; four in one, two or four, since three columns of four still take
 * two rows and only narrow the squares.
 */
export function squareGridChoices(
  count: number,
): { cols: number; rows: number }[] {
  const choices = [{ cols: 1, rows: count }];
  for (let cols = 2; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    if (rows < (choices.at(-1)?.rows ?? count)) choices.push({ cols, rows });
  }
  return choices;
}

const across = (cols: number, px: number) =>
  cols * px + (cols - 1) * GAP_ALLOWANCE_PX;

const down = (rows: number, px: number, headingPx: number) =>
  rows * (px + headingPx + GAP_ALLOWANCE_PX) + (rows - 1) * GAP_ALLOWANCE_PX;

/** How much taller a cell is than its square. */
const HEADING_ALLOWANCE = "(var(--square-grid-heading) + var(--gap-related))";

/** The height `rows` rows of `cell`-wide squares take. */
const rowsHeight = (rows: string, cell: string) =>
  `calc(var(${rows}) * (var(${cell}) + ${HEADING_ALLOWANCE}) + (var(${rows}) - 1) * var(--gap-related))`;

/*
 * The root asks for a height from its width alone: at least what draws every
 * square at the floor (or the column's width, if narrower), at most what draws
 * them as wide as `minColumnPx` columns allow, and in between the height of the
 * nearest size container, so a grid inside a scroller fills the view and grows
 * no further. No floor square is taller than that container, so each square
 * can be scrolled fully into view. Each width query picks the most columns of
 * that size that fit.
 */
function rootRules(
  count: number,
  minColumnPx: number,
  floorPx: number,
): string {
  const widths = (name: string, px: number) =>
    squareGridChoices(count)
      .slice(1)
      .map(
        ({ cols, rows }) => `
  @container square-grid-width (width >= ${across(cols, px)}px) {
    --cell-${name}: calc((100cqw - ${cols - 1} * var(--gap-related)) / ${cols});
    --rows-${name}: ${rows};
  }`,
      )
      .join("");
  return `
  --cell-full: 100cqw;
  --rows-full: ${count};
  --cell-floor: 100cqw;
  --rows-floor: ${count};
  ${widths("full", minColumnPx)}
  ${widths("floor", floorPx)}
  --cell-floor-drawn: min(var(--cell-floor), ${floorPx}px, 100cqh - ${HEADING_ALLOWANCE});
  min-height: var(--square-grid-height, clamp(${rowsHeight("--rows-floor", "--cell-floor-drawn")}, 100cqh, ${rowsHeight("--rows-full", "--cell-full")}));
`;
}

/*
 * Each column count takes over once the area is wide enough, for its height,
 * that its squares outgrow the previous count's: where the two match, less a
 * margin for the heading each row spends. A count also needs `minColumnPx`
 * columns, unless the area is too short for squares that wide in any
 * arrangement.
 */
function gridRules(count: number, minColumnPx: number, headingPx: number) {
  const choices = squareGridChoices(count);
  return choices
    .slice(1)
    .map(({ cols, rows }, i) => {
      const aspect = ((0.88 * cols) / choices[i].rows).toFixed(2);
      return `
  @container square-grid (aspect-ratio >= ${aspect}) and ((width >= ${across(cols, minColumnPx)}px) or (height < ${down(rows, minColumnPx, headingPx)}px)) {
    --cols: ${cols};
    --rows: ${rows};
  }`;
    })
    .join("");
}

const SquareGrid__Root = styled.div<{
  $count: number;
  $minColumnPx: number;
  $floorPx: number;
  $headingPx: number;
}>`
  --square-grid-heading: ${({ $headingPx }) => $headingPx}px;
  container: square-grid-width / inline-size;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  & > * {
    ${({ $count, $minColumnPx, $floorPx }) =>
      rootRules($count, $minColumnPx, $floorPx)}
  }
`;

const SquareGrid__Area = styled.div<{
  $count: number;
  $minColumnPx: number;
  $headingPx: number;
}>`
  container: square-grid / size;
  flex: 1 1 auto;
  & > * {
    --cols: 1;
    --rows: ${({ $count }) => $count};
    display: grid;
    height: 100%;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    gap: var(--gap-related);
    ${({ $count, $minColumnPx, $headingPx }) =>
      gridRules($count, $minColumnPx, $headingPx)}
  }
`;

const SquareCell__Root = styled.div`
  container-type: size;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const SquareCell__Column = styled.div`
  width: min(100cqw, 100cqh - ${HEADING_ALLOWANCE});
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const SquareCell__Heading = styled.div`
  min-width: 0;
  height: var(--square-grid-heading);
`;

const SquareCell__Square = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  aspect-ratio: 1 / 1;
  min-height: 0;
`;

/**
 * Equal squares, each under an optional heading row, laid out in as many
 * columns as draws them largest in the space the grid is given: a tall space
 * stacks them, a wide one sets them in a row. Useful for showing the operator
 * a set of drawings at a common scale that fills the tile at any size. Used by
 * a landing widget's plots.
 *
 * The grid takes its height from its container, as a flex or grid item with
 * room to grow. It asks for enough height that no square is smaller than
 * `floorPx` and lets the container scroll past that. Inside a size container
 * (`container-type: size`, such as the content of a scroller), it grows to
 * that container's height and no further, and no square is taller than it. A
 * container that sizes the grid itself, such as a fixed row beside other
 * content, sets `--square-grid-height` on an ancestor to replace the height the
 * grid asks for. Each child is a {@link SquareCell}.
 *
 * @category Layout
 */
export function SquareGrid({
  minColumnPx = 120,
  floorPx = 120,
  headingPx = 0,
  children,
  ...rest
}: SquareGridProps) {
  const count = Children.toArray(children).length;
  if (count === 0) return null;
  return (
    <SquareGrid__Root
      $count={count}
      $minColumnPx={minColumnPx}
      $floorPx={Math.min(floorPx, minColumnPx)}
      $headingPx={headingPx}
      {...rest}
    >
      <SquareGrid__Area
        $count={count}
        $minColumnPx={minColumnPx}
        $headingPx={headingPx}
      >
        <div data-square-grid="">{children}</div>
      </SquareGrid__Area>
    </SquareGrid__Root>
  );
}

/**
 * One cell of a {@link SquareGrid}: the largest square the cell holds, centred,
 * under its heading. Useful for giving each drawing in the grid the same size
 * and a title. Used inside {@link SquareGrid}.
 *
 * @category Layout
 */
export function SquareCell({ heading, children }: SquareCellProps) {
  return (
    <SquareCell__Root data-square-cell="">
      <SquareCell__Column>
        <SquareCell__Heading data-square-heading="">
          {heading}
        </SquareCell__Heading>
        <SquareCell__Square data-square="">{children}</SquareCell__Square>
      </SquareCell__Column>
    </SquareCell__Root>
  );
}
