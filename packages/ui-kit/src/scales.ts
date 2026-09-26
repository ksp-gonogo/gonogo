/**
 * The spacing and corner names the layout primitives resolve a prop against.
 *
 * Each is a handle onto a semantic token in `tokens.css`, not a value of its
 * own, so a host restyles the kit by mounting a sheet rather than by passing a
 * scale in. That keeps geometry out of the theme contract: a theme supplies
 * colours, type and borders, and the kit brings its own spacing.
 */

/**
 * The gap jobs a layout primitive's `gap`, `rowGap` or `space` prop accepts,
 * each the name of a `--gap-*` token without its prefix.
 *
 * `related` and `section` step with the container they sit in. The tier names
 * are those two jobs held at one density whatever the container, and the rest
 * are single jobs: `rows` between stacked rows that carry their own inset,
 * `caption` under the line a caption belongs to, `readout-row` between the rows
 * of a label/value grid, and `label-value` between its columns.
 */
export type GapToken =
  | "related"
  | "section"
  | "related-comfortable"
  | "related-compact"
  | "related-dense"
  | "related-packed"
  | "section-comfortable"
  | "section-compact"
  | "rows"
  | "caption"
  | "readout-row"
  | "label-value";

export const GAP_VAR = {
  related: "var(--gap-related)",
  section: "var(--gap-section)",
  "related-comfortable": "var(--gap-related-comfortable)",
  "related-compact": "var(--gap-related-compact)",
  "related-dense": "var(--gap-related-dense)",
  "related-packed": "var(--gap-related-packed)",
  "section-comfortable": "var(--gap-section-comfortable)",
  "section-compact": "var(--gap-section-compact)",
  rows: "var(--gap-rows)",
  caption: "var(--gap-caption)",
  "readout-row": "var(--gap-readout-row)",
  "label-value": "var(--gap-label-value)",
} as const satisfies Record<GapToken, string>;

/**
 * The surface insets `Box`'s `pad` prop accepts, each the name of an
 * `--inset-*` token without its prefix. The map holds the bare token name, and
 * `Box` reads it in the padding shorthand, the only place a pair belongs.
 */
export type InsetToken =
  | "chip"
  | "chip-roomy"
  | "chip-readout"
  | "pill"
  | "surface"
  | "surface-standalone"
  | "popover";

export const INSET_NAME = {
  chip: "--inset-chip",
  "chip-roomy": "--inset-chip-roomy",
  "chip-readout": "--inset-chip-readout",
  pill: "--inset-pill",
  surface: "--inset-surface",
  "surface-standalone": "--inset-surface-standalone",
  popover: "--inset-popover",
} as const satisfies Record<InsetToken, `--inset-${string}`>;

/**
 * The corner handles a surface primitive accepts.
 *
 * Three, and they name a role rather than a size: an ordinary corner, a corner
 * on something floating above the app, and a stadium. `displayFrame` is not
 * here because that corner belongs to `FramedDisplay` alone, and `circle` is
 * not a corner at all.
 */
export type RadiusToken = "regular" | "floating" | "pill";

export const RADIUS_VAR = {
  /** Every ordinary corner: controls, chips, rows, cells, cards, menus. */
  regular: "var(--radius-regular)",
  /** A box that sits above the app: a modal, a dialog, the FAB, the landing surface. */
  floating: "var(--radius-floating)",
  /** Fully rounded: chips, avatars, toggle knobs. */
  pill: "var(--radius-pill)",
} as const satisfies Record<RadiusToken, string>;
