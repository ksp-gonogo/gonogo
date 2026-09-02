import { css } from "styled-components";

/** The five-word severity vocabulary `Badge`, `Meter` and `StatEntry` share. */
export type StatTone = "neutral" | "go" | "warn" | "nogo" | "info";

/**
 * What each tone colours a FIGURE, as opposed to a fill or a pill.
 *
 * One map for `Stat` and `DataLine` rather than one each: two copies of a
 * tone-to-colour table is how a tone comes to mean one thing in a strip and
 * another on the line below it, and the kit already carried three such copies
 * before `Card`'s `tone` collected them.
 */
export const STAT_TONE_COLOR: Record<StatTone, ReturnType<typeof css>> = {
  neutral: css`
    color: var(--color-text-primary);
  `,
  go: css`
    color: var(--color-accent-fg);
  `,
  /* The MUTED amber, for the reason `Text`'s own `warn` tone gives: the bright
     `--color-status-warning-fg` is a near-black meant for text sitting ON the
     amber chip, and on a panel it renders dark on dark. */
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
