import type { Severity } from "./severity";

/**
 * The single saturated fill each `Severity` reads as on a panel surface: a
 * status dot, or (via `Badge`'s `SEVERITY_STYLES`) the accent for the three
 * severities whose Badge chip is already vivid enough to double as it.
 *
 * `info`, `caution` and `offline` deliberately do NOT match Badge's own chip
 * `background`: at full chip size those tokens read fine, but a small dot
 * painted the same colour is near-invisible on a panel surface, so this
 * substitutes the muted/fg/dim token instead for exactly those three. That
 * divergence is intentional design, not drift; what this function removes is
 * the drift risk of TWO hand-typed maps that were supposed to stay "in step"
 * (the title ghost's dot map carried that exact phrase in a comment) with no
 * mechanism enforcing it. One function both read from is how it can't.
 *
 * `nominal` never actually paints a dot in the ghost (a healthy panel
 * summarises to `null`), mapped here for completeness and because Badge's
 * nominal chip does consume this value.
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
