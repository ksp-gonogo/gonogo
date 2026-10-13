/**
 * The smallest tile, in grid units, that any widget with a tiny mode can be
 * resized to. One size for every widget, since the tiny form draws only a
 * widget's essentials. Used by {@link registerComponent}, which refuses a
 * widget whose `minSize` is not larger than it. A widget with no tiny mode is
 * not held to it: its own `minSize` alone sets how small it can be resized.
 *
 * @category Registering
 */
export const TINY_SIZE = {
  /** Width, in grid columns. */
  w: 3,
  /** Height, in grid rows. */
  h: 3,
} as const;
