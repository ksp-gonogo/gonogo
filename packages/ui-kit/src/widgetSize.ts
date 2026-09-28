/**
 * Size buckets for responsive widget rendering. Widgets read their `w`/`h`
 * grid units from `ComponentProps` and derive a bucket here so the boundaries
 * stay consistent across every widget.
 *
 * - `tiny`  : single-glance status / one key readout
 * - `small` : essential numbers, minimal chrome
 * - `normal`: full widget UI
 *
 * Boundaries chosen so the existing `defaultSize`s land in `normal`. A widget
 * that declares a tiny mode is drawn by the kit in `tiny`; every other bucket,
 * and every bucket of a widget without one, is the widget's own to lay out.
 *
 * @category Layout
 */
export type SizeBucket = "tiny" | "small" | "normal";

/**
 * A tile narrower or shorter than this is `tiny`.
 *
 * @category Layout
 */
export const TINY_BELOW = { w: 5, h: 4 } as const;
const SMALL_W = 8;
const SMALL_H = 7;

/**
 * The {@link SizeBucket} a `w` by `h` tile falls in.
 *
 * @category Layout
 */
export function getSizeBucket(
  w: number | undefined,
  h: number | undefined,
): SizeBucket {
  // Missing dims (e.g. before the grid has measured), assume normal so the first paint isn't a flash of compact UI.
  if (w === undefined || h === undefined) return "normal";
  if (w < TINY_BELOW.w || h < TINY_BELOW.h) return "tiny";
  if (w < SMALL_W || h < SMALL_H) return "small";
  return "normal";
}

/**
 * Shape (orientation) of a widget, orthogonal to its size bucket. A widget can
 * be `tiny` and `landscape`, or `normal` and `portrait`, the two signals
 * answer different questions. `getSizeBucket` says *how much chrome* to show;
 * `getWidgetShape` says *which way to flow it*.
 *
 * - `portrait` : tall + narrow: stack content in a single column; dock any
 *                 secondary panel/legend *below* the primary content.
 * - `landscape`: wide + short: flow content into multiple columns or place a
 *                 secondary panel *beside* the primary content, using the
 *                 width the size bucket alone can't see.
 * - `square`   : neither axis dominates; the default near-1:1 layout. Also the
 *                 neutral fallback before the grid has measured (see below).
 *
 * @category Layout
 */
export type WidgetShape = "portrait" | "landscape" | "square";

/**
 * A tile's {@link WidgetShape} and the aspect ratio it was read from.
 *
 * @category Layout
 */
export interface WidgetShapeInfo {
  shape: WidgetShape;
  /**
   * Raw grid aspect ratio, `w / h`. > 1 is wider-than-tall, < 1 is
   * taller-than-wide, exactly 1 is square. Provided for widgets that want a
   * continuous signal (e.g. an interpolated gap or column count) rather than
   * the coarse three-way enum. `1` when dims are missing.
   */
  aspect: number;
}

/**
 * Landscape begins once a widget is this many times wider than it is tall.
 *
 * The render harness's two aspect-extreme modes are deliberately log-symmetric
 * around 1:1: `portrait-5x18` has aspect ≈ 0.28 and `landscape-18x5` ≈ 3.6,
 * and log(0.28) ≈ −1.27 mirrors log(3.6) ≈ +1.28. So we center the square band
 * on aspect = 1 and derive the portrait cutoff as the reciprocal of this one
 * constant: a single named threshold, no second magic number.
 *
 * The value (1.6) is picked to sit *above* the near-square auto-modes so they
 * stay `square` and take the unchanged single-column path, but well below the
 * 3.6 landscape extreme so that genuinely wide boxes reflow:
 *
 *   - `default-5x7`  → aspect 0.71  → square     (between 0.625 and 1.6)
 *   - `mobile-9x8`   → aspect 1.125 → square     (between 0.625 and 1.6)
 *   - `landscape-18x5` → aspect 3.6 → landscape  (≥ 1.6)
 *   - `portrait-5x18`  → aspect 0.28 → portrait  (≤ 0.625 = 1/1.6)
 *
 * Boundaries are inclusive of the cutoff (`>=` / `<=`) so a box sitting exactly
 * on the threshold commits to the reflow rather than dithering at square.
 */
const LANDSCAPE_ASPECT = 1.6;
const PORTRAIT_ASPECT = 1 / LANDSCAPE_ASPECT; // ≈ 0.625

/**
 * The {@link WidgetShape} of a `w` by `h` tile.
 *
 * @category Layout
 */
export function getWidgetShape(
  w: number | undefined,
  h: number | undefined,
): WidgetShapeInfo {
  // Missing dims (e.g. before the grid has measured), assume `square`, the
  // neutral no-reflow default. The size-bucket analogue is `normal`: pick the
  // value that doesn't flash a divergent layout on first paint. Returning
  // `landscape` here would briefly show a multi-column layout before measure.
  if (w === undefined || h === undefined || h === 0) {
    return { shape: "square", aspect: 1 };
  }
  const aspect = w / h;
  if (aspect >= LANDSCAPE_ASPECT) return { shape: "landscape", aspect };
  if (aspect <= PORTRAIT_ASPECT) return { shape: "portrait", aspect };
  return { shape: "square", aspect };
}
