/**
 * The state a badge, meter, figure, plot layer or button shows: a contribution
 * names a tone, never a colour, and ui-kit chooses the colour for where it is
 * drawn.
 *
 * `neutral` carries no state. `info` is something worth noticing that is
 * neither good nor bad. `go` is all well. `caution` is a milder `warn`, and
 * `nogo` is worse than either. `offline` means the data behind the thing is
 * gone, which is not the same as a neutral reading.
 *
 * @category Tone
 * @categoryDescription Tone
 * The words a widget uses for state (`neutral`, `info`, `go`, `caution`,
 * `warn`, `nogo`, `offline`) in place of colours, so every widget and contribution says the same thing the
 * same way and ui-kit picks the colour for where it is drawn.
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
 * The tones a contribution uses to say how alarming something is. There is no
 * "all is well" tone: leave out an entry with nothing to report.
 *
 * @category Tone
 */
export type AlertTone = Extract<Tone, "info" | "warn" | "nogo">;
