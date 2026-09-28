import type { Tone } from "@ksp-gonogo/sitrep-sdk";

/*
 * What colour a tone is depends on the job the colour does, so there is one
 * map per job and a caller picks the map by what it is drawing. Each value is
 * a role token from the theme, which the contrast gate holds to its grounds.
 */

/**
 * A tone's words on a surface, or on its own muted ground.
 *
 * @category Tone
 */
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
  neutral: "var(--color-neutral-text)",
  info: "var(--color-info-text)",
  go: "var(--color-go-text)",
  caution: "var(--color-caution-text)",
  warn: "var(--color-warn-text)",
  nogo: "var(--color-nogo-text)",
  offline: "var(--color-offline-text)",
};

/**
 * A tone standing alone: a dot, fill, edge or stroke with no text of its own.
 *
 * @category Tone
 */
export const TONE_MARK: Readonly<Record<Tone, string>> = {
  neutral: "var(--color-neutral-mark)",
  info: "var(--color-info-mark)",
  go: "var(--color-go-mark)",
  caution: "var(--color-caution-mark)",
  warn: "var(--color-warn-mark)",
  nogo: "var(--color-nogo-mark)",
  offline: "var(--color-offline-mark)",
};

/**
 * A fill that carries its own text, drawn in `TONE_ON_STATUS`.
 *
 * @category Tone
 */
export const TONE_STATUS: Readonly<Record<Tone, string>> = {
  neutral: "var(--color-neutral-status)",
  info: "var(--color-info-status)",
  go: "var(--color-go-status)",
  caution: "var(--color-caution-status)",
  warn: "var(--color-warn-status)",
  nogo: "var(--color-nogo-status)",
  offline: "var(--color-offline-status)",
};

/**
 * The text on a `TONE_STATUS` fill.
 *
 * @category Tone
 */
export const TONE_ON_STATUS: Readonly<Record<Tone, string>> = {
  neutral: "var(--color-neutral-on-status)",
  info: "var(--color-info-on-status)",
  go: "var(--color-go-on-status)",
  caution: "var(--color-caution-on-status)",
  warn: "var(--color-warn-on-status)",
  nogo: "var(--color-nogo-on-status)",
  offline: "var(--color-offline-on-status)",
};

/**
 * A quiet ground under ordinary text, tinted by the tone.
 *
 * @category Tone
 */
export const TONE_MUTED: Readonly<Record<Tone, string>> = {
  neutral: "var(--color-neutral-muted)",
  info: "var(--color-info-muted)",
  go: "var(--color-go-muted)",
  caution: "var(--color-caution-muted)",
  warn: "var(--color-warn-muted)",
  nogo: "var(--color-nogo-muted)",
  offline: "var(--color-offline-muted)",
};

/**
 * The word a screen reader hears for a tone that is announced rather than seen.
 *
 * @category Tone
 */
export const TONE_LABEL: Readonly<Record<Tone, string>> = {
  neutral: "neutral",
  info: "info",
  go: "nominal",
  caution: "caution",
  warn: "warning",
  nogo: "critical",
  offline: "offline",
};

/**
 * A box's edge in a tone: the tone's mark, except `neutral`, which has no state to edge with and takes the decorative border.
 *
 * @category Tone
 */
export function toneEdge(tone: Tone): string {
  return tone === "neutral" ? "var(--color-border-subtle)" : TONE_MARK[tone];
}
