/** What a tile of `cols` by `rows` grid units shows of the orbit. */
export interface OrbitViewLayout {
  /** The figures wrap onto the smallest type tier. */
  tight: boolean;
  /** The figures use the middle type tier. */
  narrow: boolean;
  showInclination: boolean;
  showApProgress: boolean;
  showEccentricityAndPeriod: boolean;
  /** The diagram joins the figures; below this the figures are the whole body. */
  hasDiagramRoom: boolean;
  /** The panel title shortens to fit beside the status chips. */
  compactTitle: boolean;
  /** The regime badge uses its abbreviations. */
  compactBadge: boolean;
}

/**
 * Every threshold only turns something on as a tile grows, so a larger tile
 * never loses a figure a smaller one shows. The diagram needs a tile that is
 * tall enough to stack it over the figures or wide enough to set them beside it.
 */
export function orbitViewLayout(cols: number, rows: number): OrbitViewLayout {
  return {
    tight: cols < 4 || rows < 5,
    narrow: cols < 5,
    showInclination: rows >= 5,
    showApProgress: rows >= 6,
    showEccentricityAndPeriod: rows >= 8,
    hasDiagramRoom: (cols >= 5 && rows >= 8) || (cols >= 12 && rows >= 5),
    compactTitle: cols < 4,
    compactBadge: cols < 4,
  };
}
