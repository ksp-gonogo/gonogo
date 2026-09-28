import styled from "styled-components";

export const BODY_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
} as const;

export type RateTone = "physics" | "high";

/**
 * Physics warp tints amber: at speed in atmosphere the operator needs to know
 * it is not on-rails.
 */
export function rateStyle(tone: RateTone) {
  return {
    flex: "1 1 70px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-related)",
    minWidth: 0,
    color:
      tone === "physics" ? "var(--color-warn-mark)" : "var(--color-go-text)",
  } as const;
}

/* Off the type scale, which stops at --font-size-lg: this is a display-tier readout. */
export const RATE_VALUE_STYLE = {
  fontSize: "24px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  lineHeight: "var(--line-height-flush)",
} as const;

/* minWidth 0 lets the grid shrink below its 8-button min-content instead of clipping. */
export const FULL_LADDER_STYLE = {
  flex: "2 1 140px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(40px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

export const STEP_LADDER_STYLE = {
  flex: "1 1 100px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(28px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

/* The buttons and the alarm row under them, as one column beside the rate readout. */
export const CONTROLS_STYLE = {
  flex: "3 1 180px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

export const CONTROL_ROW_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
} as const;

/* A row of its own under the buttons. */
export const FOOT_ROW_STYLE = {
  minWidth: 0,
} as const;

/* Sized to the name rather than filling the row, so the countdown sits beside it. */
export const ALARM_NAME_STYLE = {
  flex: "0 1 auto",
  fontSize: "var(--font-size-sm)",
} as const;

/* Styled rather than inline for its :focus-visible ring. */
export const WarpButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-go-status)" : "var(--color-surface-raised)"};
  color: var(--color-go-on-status);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-go-status)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  padding: var(--inset-warp-button);
  font-size: var(--font-size-compact);
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  letter-spacing: 0.04em;
  cursor: pointer;
  min-width: 0;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;
