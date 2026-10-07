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
 * What a figure is, for the purpose of marking it: `current` is a reading of
 * now, and the other two are the {@link ReckoningKind}s.
 *
 * @category Unit
 */
export type MarkKind = "current" | ReckoningKind;

/**
 * The stroke of a hollow mark, the form a mark takes for a figure that is of
 * something other than what its label names (`elsewhere`).
 *
 * @category Unit
 */
export const HOLLOW_MARK_STROKE = "max(0.075em, 1.25px)";

/**
 * The spec for each kind. `held` is a square in the warning hue; `modelled`
 * is a triangle, point up, in the modelled hue and about a pixel larger, so
 * the two weigh alike at small sizes.
 *
 * Each also has a hollow form, drawn where the figure is `elsewhere`: of
 * something other than what its label names. Hollow says that and nothing
 * else; the shape and the hue go on saying how current the figure is. A hollow
 * mark is drawn larger than its filled twin, at `hollowDomSize`. `current` has
 * only the hollow form, a ring: a current figure of the thing its label names
 * carries no mark at all.
 *
 * @category Unit
 */
export const RECKONING_MARK = {
  current: {
    shape: "ring",
    glyph: "○",
    color: "var(--color-elsewhere-mark)",
    cssVar: "--color-elsewhere-mark",
    fallback: "rgb(170 156 255)",
    hollowDomSize: "max(calc(0.3em + 2px), 6px)",
    canvasRadius: 5,
  },
  held: {
    shape: "square",
    glyph: "■",
    color: "var(--color-warn-mark)",
    cssVar: "--color-warn-mark",
    fallback: "rgb(217 161 59)",
    domSize: "max(0.3em, 4px)",
    hollowDomSize: "max(calc(0.3em + 2px), 6px)",
    canvasRadius: 4,
  },
  modelled: {
    shape: "triangle",
    glyph: "▲",
    color: "var(--color-modelled-mark)",
    cssVar: "--color-modelled-mark",
    fallback: "rgb(138 180 248)",
    domSize: "max(calc(0.3em + 1px), 5px)",
    hollowDomSize: "max(calc(0.3em + 3px), 7px)",
    canvasRadius: 5,
  },
} as const;
