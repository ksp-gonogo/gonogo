import type { Severity } from "./severity";

/**
 * The single saturated accent each `Severity` reads as on a panel surface: a
 * collapsed header's status dot, and (via `Badge`'s `pillColor`) a pill's
 * outline, text and glow. Every value clears 3:1 against the panel.
 */
export function severityDotColor(severity: Severity): string {
  switch (severity) {
    case "nominal":
      return "var(--color-accent-fg)";
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
