/**
 * The one tone scale every surface speaks: a badge, a meter's fill, a figure,
 * a plot layer, a button. The tone says what state a thing is in; how it is
 * coloured depends on what the colour is doing (text, a mark standing alone,
 * a fill carrying its own text, a quiet ground), and ui-kit's role maps decide
 * that, so a contribution names a tone and never a colour.
 *
 * `neutral` carries no state at all. `caution` is the milder rung of `warn`.
 * `offline` means the data behind the thing is gone, which is not the same as
 * a neutral reading.
 *
 * @category Tone
 */
export type Tone =
  | "neutral"
  | "info"
  | "go"
  | "caution"
  | "warn"
  | "nogo"
  | "offline";

/**
 * Every {@link Tone}, in the order a legend lists them.
 *
 * @category Tone
 */
export const TONES: readonly Tone[] = [
  "neutral",
  "info",
  "go",
  "caution",
  "warn",
  "nogo",
  "offline",
];

/**
 * The tones a contribution names to say how alarming a thing is, with no
 * rung for "all is well": an entry with nothing to report is left out rather
 * than contributed. The host decides what each looks like.
 *
 * @category Tone
 */
export type AlertTone = Extract<Tone, "info" | "warn" | "nogo">;
