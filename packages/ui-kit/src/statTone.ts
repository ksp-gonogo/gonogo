import { css } from "styled-components";

/** The five-word severity vocabulary `Badge`, `Meter` and `StatEntry` share. */
export type StatTone = "neutral" | "go" | "warn" | "nogo" | "info";

/** What each tone colours a FIGURE, as opposed to a fill or a pill. */
export const STAT_TONE_COLOR: Record<StatTone, ReturnType<typeof css>> = {
  neutral: css`
    color: var(--color-text-primary);
  `,
  go: css`
    color: var(--color-accent-fg);
  `,
  // The muted amber: `--color-status-warning-fg` is meant for text on the amber chip and renders dark on a panel.
  warn: css`
    color: var(--color-status-warning-fg-muted);
  `,
  nogo: css`
    color: var(--color-status-nogo-fg);
  `,
  info: css`
    color: var(--color-status-info-fg);
  `,
};
