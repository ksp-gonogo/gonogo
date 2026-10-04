/**
 * The one definition of how a figure that is not a reading of now is marked.
 * The DOM marks, the SVG tspans and the canvas painters all read it, so a
 * change of hue, shape or size happens here and nowhere else.
 */

/**
 * Which mark: `held` is the last observation kept past its time, `modelled` is
 * a figure a model carried to now.
 *
 * @category Unit
 */
export type ReckoningKind = "held" | "modelled";

/**
 * The spec for each kind. `held` is a dot in the warning hue; `modelled` is a
 * triangle, point up, in the modelled hue and about a pixel larger, so the two
 * weigh alike at small sizes.
 *
 * @category Unit
 */
export const RECKONING_MARK = {
  held: {
    shape: "dot",
    glyph: "●",
    color: "var(--color-warn-mark)",
    cssVar: "--color-warn-mark",
    fallback: "#d9a13b",
    domSize: "max(0.3em, 4px)",
    canvasRadius: 4,
  },
  modelled: {
    shape: "triangle",
    glyph: "▲",
    color: "var(--color-modelled-mark)",
    cssVar: "--color-modelled-mark",
    fallback: "#8ab4f8",
    domSize: "max(calc(0.3em + 1px), 5px)",
    canvasRadius: 5,
  },
} as const;
