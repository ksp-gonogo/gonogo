/**
 * The spacing and corner names the layout primitives resolve a prop against.
 *
 * Each is a handle onto a semantic token in `tokens.css`, not a value of its
 * own, so a host restyles the kit by mounting a sheet rather than by passing a
 * scale in. That keeps geometry out of the theme contract: a theme supplies
 * colours, type and borders, and the kit brings its own spacing.
 */

/**
 * The spacing names a layout primitive's `gap`, `rowGap` or `space` prop
 * accepts. Each names what the space is for, and resolves to the `--gap-*`
 * CSS variable of the same name.
 *
 * - `related` and `section`: between related items, and between sections:
 *   8px and 16px on a panel, 6px and 12px inside a {@link Card}
 * - `related-comfortable` (8px), `related-compact` (6px), `related-dense`
 *   (4px), `related-packed` (2px), `section-comfortable` (16px) and
 *   `section-compact` (12px): the same two spacings at one fixed density,
 *   whatever the container
 * - `rows` (2px): between stacked rows that carry their own padding
 * - `caption` (2px): under the line a caption belongs to
 * - `readout-row` (2px) and `label-value` (8px): between the rows and between
 *   the columns of a label/value grid
 *
 * The pixel values are the default sheet's; a host that mounts its own sheet
 * may change them.
 *
 * @category Layout
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
 * The padding names {@link Box}'s `pad` prop accepts, each resolving to the
 * `--inset-*` CSS variable of the same name, given here as vertical then
 * horizontal padding in the default sheet:
 *
 * - `chip` (1px 6px), `chip-roomy` (1px 8px) and `chip-readout` (2px 8px):
 *   small pills
 * - `pill` (6px 12px): a stadium
 * - `surface` (6px 8px) and `surface-standalone` (10px 12px): a block's own
 *   padding
 * - `popover` (8px all round): a floating card
 *
 * @category Layout
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
 * on something floating above the app, and a stadium. The display-frame
 * corner is not here because it belongs to `FramedDisplay` alone, and `circle` is
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
