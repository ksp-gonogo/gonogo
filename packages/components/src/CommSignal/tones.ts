// `neutral` is the no-verdict tone, not a severity between ok and warn.
export type Tone = "ok" | "warn" | "lost" | "neutral";

export const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
};

// Warning text uses the muted token: the bare warning `-fg` is near-black, meant for the chip.
export const TONE_TEXT_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-fg)",
  neutral: "var(--color-text-primary)",
};

/** The dim uppercase label beside a detail figure or above the route. */
export const CAPTION_LABEL_STYLE = {
  color: "var(--color-text-dim)",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};
