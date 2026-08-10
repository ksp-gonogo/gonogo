import type { Severity } from "./severity";

/**
 * The single saturated accent each `Severity` reads as on a panel surface: a
 * status dot, or (via `Badge`'s `pillColor`) the outline/text/glow colour for
 * every severity except `nominal`, which paints `--color-accent-fg` instead
 * (see `pillColor`'s own comment: this function's `nominal` value is a DARK
 * fill tuned for a small dot, not something a pill can paint its own
 * outline/text in and still clear contrast).
 *
 * What this function removes is the drift risk of TWO hand-typed maps that
 * were supposed to stay "in step" (the title ghost's dot map carried that
 * exact phrase in a comment) with no mechanism enforcing it. One function
 * both read from is how it can't.
 *
 * `nominal` never actually paints a dot in the ghost (a healthy panel
 * summarises to `null`), mapped here for completeness only.
 */
export function severityDotColor(severity: Severity): string {
  switch (severity) {
    case "nominal":
      return "var(--color-status-go-bg)";
    case "info":
      return "var(--color-status-info-fg)";
    case "caution":
      return "var(--color-status-warning-fg-muted)";
    case "warning":
      return "var(--color-status-warning-bg)";
    case "critical":
      return "var(--color-status-nogo-bg)";
    case "offline":
      return "var(--color-text-dim)";
  }
}
