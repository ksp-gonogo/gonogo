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
  /** A reading of now: carries no mark of its own, only the hollow ring. */
  current: {
    /** The mark's shape, by name. */
    shape: "ring",
    /** The same shape as one text character, where the mark is drawn as text. */
    glyph: "○",
    /** The hue, as a CSS `var()` of the theme token. */
    color: "var(--color-elsewhere-mark)",
    /** The theme token's name, for a canvas painter that resolves it itself. */
    cssVar: "--color-elsewhere-mark",
    /** The hue to use where the token cannot be read. */
    fallback: "rgb(170 156 255)",
    /** The hollow form's size in the DOM, drawn for a figure of something other than what its label names. */
    hollowDomSize: "max(calc(0.3em + 2px), 6px)",
    /** The mark's radius on a canvas, in canvas pixels at 1x. */
    canvasRadius: 5,
  },
  /** The last observation kept past its time: a square in the warning hue. */
  held: {
    /** The mark's shape, by name. */
    shape: "square",
    /** The same shape as one text character, where the mark is drawn as text. */
    glyph: "■",
    /** The hue, as a CSS `var()` of the theme token. */
    color: "var(--color-warn-mark)",
    /** The theme token's name, for a canvas painter that resolves it itself. */
    cssVar: "--color-warn-mark",
    /** The hue to use where the token cannot be read. */
    fallback: "rgb(217 161 59)",
    /** The filled mark's side in the DOM, as a CSS length that follows the text size. */
    domSize: "max(0.3em, 4px)",
    /** The hollow form's size in the DOM, drawn for a figure of something other than what its label names. */
    hollowDomSize: "max(calc(0.3em + 2px), 6px)",
    /** The mark's radius on a canvas, in canvas pixels at 1x. */
    canvasRadius: 4,
  },
  /** A figure a model carried to now: a triangle, point up, in the modelled hue. */
  modelled: {
    /** The mark's shape, by name. */
    shape: "triangle",
    /** The same shape as one text character, where the mark is drawn as text. */
    glyph: "▲",
    /** The hue, as a CSS `var()` of the theme token. */
    color: "var(--color-modelled-mark)",
    /** The theme token's name, for a canvas painter that resolves it itself. */
    cssVar: "--color-modelled-mark",
    /** The hue to use where the token cannot be read. */
    fallback: "rgb(138 180 248)",
    /** The filled mark's side in the DOM, as a CSS length that follows the text size. */
    domSize: "max(calc(0.3em + 1px), 5px)",
    /** The hollow form's size in the DOM, drawn for a figure of something other than what its label names. */
    hollowDomSize: "max(calc(0.3em + 3px), 7px)",
    /** The mark's radius on a canvas, in canvas pixels at 1x. */
    canvasRadius: 5,
  },
} as const;
