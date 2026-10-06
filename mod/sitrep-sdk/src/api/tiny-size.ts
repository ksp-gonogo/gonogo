/**
 * The smallest tile, in grid units, that any widget with a tiny mode can be
 * resized to. One size for every widget: the tiny form draws only a widget's
 * essentials, so there is nothing for an individual widget to ask more room
 * for.
 *
 * @category Registering
 */
export const TINY_SIZE = { w: 3, h: 3 } as const;
