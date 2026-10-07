/**
 * The smallest tile, in grid units, that any widget with a tiny mode can be
 * resized to. One size for every widget: the tiny form draws only a widget's
 * essentials, so there is nothing for an individual widget to ask more room
 * for.
 *
 * @category Registering
 */
export const TINY_SIZE = {
  /** Width, in grid columns. */
  w: 3,
  /** Height, in grid rows. */
  h: 3,
} as const;
