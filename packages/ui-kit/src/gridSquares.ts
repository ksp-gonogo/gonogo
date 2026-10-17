/**
 * The gap between cells as a px figure, for the container queries, which
 * cannot read a custom property. It moves only the points at which the column
 * count changes.
 */
const GAP_ALLOWANCE_PX = 8;

/**
 * The column counts worth offering `count` cells: one, then each count that
 * saves a row over the one before it. Three cells sit in one, two or three
 * columns; four in one, two or four, since three columns of four still take
 * two rows and only narrow the squares.
 */
export function squareColumnChoices(
  count: number,
): { cols: number; rows: number }[] {
  const choices = [{ cols: 1, rows: count }];
  for (let cols = 2; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    if (rows < (choices.at(-1)?.rows ?? count)) choices.push({ cols, rows });
  }
  return choices;
}

/** How much taller a cell is than its square: the heading band and the gap under it, or nothing with no band. */
export function squareHeadingAllowance(headingPx: number): string {
  if (headingPx === 0) return "0px";
  return `(${headingPx}px + var(--gap-related))`;
}

const across = (cols: number, min: string) =>
  `calc(${cols} * ${min} + ${(cols - 1) * GAP_ALLOWANCE_PX}px)`;

const down = (rows: number, rowMin: string, headingPx: number) =>
  `calc(${rows} * (${rowMin} + ${headingPx + GAP_ALLOWANCE_PX}px) + ${(rows - 1) * GAP_ALLOWANCE_PX}px)`;

/*
 * The height the area asks for, from its width alone: at least what draws
 * every square at `min` (or the column's width, if narrower), at most what
 * draws them as wide as `min` columns allow, and in between the height of the
 * nearest size container, so a grid inside a scroller fills the view and grows
 * no further. No floor square is taller than that container, so each one can
 * be scrolled fully into view. Each width query picks the most columns of that
 * size that fit; `--grid-squares-height` on an ancestor replaces the result.
 *
 * Given `rowMin`, the cells fill the area rather than stay square, so it asks
 * for only the rows at that height and its flex parent grows it to the rest.
 */
export function squareAreaRules(
  count: number,
  min: string,
  headingPx: number,
  gap: string,
  rowMin?: string,
): string {
  const heading = squareHeadingAllowance(headingPx);
  const widths = squareColumnChoices(count)
    .slice(1)
    .map(
      ({ cols, rows }) => `
  @container grid-squares-width (width >= ${across(cols, min)}) {
    --cell: calc((100cqw - ${cols - 1} * ${gap}) / ${cols});
    --rows: ${rows};
  }`,
    )
    .join("");
  const rowsHeight = (cell: string) =>
    `calc(var(--rows) * (${cell} + ${heading}) + (var(--rows) - 1) * ${gap})`;
  if (rowMin !== undefined)
    return `
  --cell: 100cqw;
  --rows: ${count};
  ${widths}
  min-height: var(--grid-squares-height, ${rowsHeight(rowMin)});
`;
  return `
  --cell: 100cqw;
  --rows: ${count};
  ${widths}
  min-height: var(--grid-squares-height, clamp(${rowsHeight(`min(var(--cell), ${min}, 100cqh - ${heading})`)}, 100cqh, ${rowsHeight("var(--cell)")}));
`;
}

/*
 * Each column count takes over once the area is wide enough, for its height,
 * that its squares outgrow the previous count's: where the two match, less a
 * margin for the heading each row spends. A count also needs columns of `min`,
 * unless the area is too short for the previous count's rows at that size (so
 * the previous count cannot draw squares of `min` either, and the count with
 * more columns draws them larger). When the cells fill the area, the count is
 * instead held to rows of `rowMin` and the area is too short only for its own.
 */
export function squareGridRules(
  count: number,
  min: string,
  headingPx: number,
  rowMin?: string,
): string {
  const choices = squareColumnChoices(count);
  const fills = rowMin !== undefined;
  return choices
    .slice(1)
    .map(({ cols, rows }, i) => {
      const aspect = ((0.88 * cols) / choices[i].rows).toFixed(2);
      return `
  @container grid-squares (aspect-ratio >= ${aspect}) and ((width >= ${across(cols, min)}) or (height < ${down(fills ? rows : choices[i].rows, rowMin ?? min, headingPx)})) {
    --cols: ${cols};
    --rows: ${rows};
  }`;
    })
    .join("");
}

/*
 * The rules a cell's content reads its heading band from. They sit on the
 * cell's children, since a container query styles only what is inside its
 * container, and the cell is the container.
 */
export function squareHeadingRules(
  headingPx: number,
  headingMinPx?: number,
): string {
  const kept = `
  & > * > * {
    --grid-square-heading: ${headingPx === 0 ? "0px" : `calc${squareHeadingAllowance(headingPx)}`};
  }`;
  if (headingPx === 0 || headingMinPx === undefined) return kept;
  return `${kept}
  @container (width < ${headingMinPx}px) or (height < ${headingMinPx + headingPx + GAP_ALLOWANCE_PX}px) {
    & > * > * {
      --grid-square-heading: 0px;
    }
    & > * [data-grid-square-heading] {
      display: none;
    }
  }`;
}
