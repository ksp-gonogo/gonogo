/**
 * The spacing and corner ladders the layout primitives resolve a size prop
 * against.
 *
 * These are handles onto the rungs in `tokens.css`, not values of their own, so
 * a host restyles the kit by mounting a sheet that redefines `--space-8` rather
 * than by passing a scale in. That keeps the ladder out of the theme contract: a
 * theme supplies colours, type and borders, and the kit brings its own geometry.
 *
 * The t-shirt names do not track the rung numbers (`md` is the 8 rung) and are
 * not renamed to match. A size prop names how big a gap FEELS relative to its
 * siblings; the rung is the pixel count it happens to land on this year.
 */

/**
 * The space handles a layout primitive accepts, ordered smallest first.
 *
 * `sm+` (6px) and `md+` (10px) were briefly members, to reach the two rungs this
 * union omits. They are gone and nothing ever passed one: a size union that
 * needs half-steps is aliasing the wrong ladder, and the spacing it was reaching
 * for belongs to the semantic layer over panels, cards and containers, which
 * resolves by context rather than by size.
 */
export type SpaceToken = "xs" | "sm" | "md" | "lg" | "xl";

export const SPACE_VAR = {
  xs: "var(--space-2)",
  sm: "var(--space-4)",
  md: "var(--space-8)",
  lg: "var(--space-12)",
  xl: "var(--space-16)",
} as const satisfies Record<SpaceToken, string>;

export const RADIUS_VAR = {
  /** Tightest corner: buttons and small controls. */
  xs: "var(--radius-xs)",
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  /** Widest square corner: overlay and dialog surfaces. */
  lg: "var(--radius-lg)",
  /** Fully rounded: chips, avatars, toggle knobs. */
  pill: "var(--radius-pill)",
} as const;
