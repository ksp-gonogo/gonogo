/**
 * How a widget draws values over a stretch of time, against a value at one
 * moment. Useful for a map trail or a plotted series whose source holds more
 * than the moment on screen, as a recorded flight or a predicted one does, so
 * the operator reads which part has happened by that moment and which has
 * not. Used by the ground track's trail.
 *
 * A range is a line in the series' own colour. The part up to the moment on
 * screen (`reached`) is drawn at full strength. The part after it (`ahead`)
 * is the same line, dimmer and thinner: the same data, not yet reached. A
 * value at one moment is a mark, never a line. A dashed line is not a range:
 * it stays a model's own path, such as a reckoned orbit.
 *
 * Each part is a pair of multipliers on the line's own opacity and width.
 *
 * @category Unit
 */
export const RANGE_MARK = {
  /** The part of a range at or before the moment on screen. */
  reached: { alpha: 1, width: 1 },
  /** The part of a range after the moment on screen. */
  ahead: { alpha: 0.6, width: 0.5 },
} as const;

/**
 * Which part of a range a value at `ut` belongs to, for the moment on screen
 * `atUt`. Useful for picking a line's strength from {@link RANGE_MARK} point
 * by point.
 *
 * @category Unit
 */
export function rangePart(ut: number, atUt: number): keyof typeof RANGE_MARK {
  return ut > atUt ? "ahead" : "reached";
}
