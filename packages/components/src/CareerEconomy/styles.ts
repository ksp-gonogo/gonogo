import { FAINT_TEXT_STYLE } from "@ksp-gonogo/ui-kit";

export const BALANCES_STYLE = {
  display: "flex",
  gap: "1.2rem",
  flexWrap: "wrap",
} as const;

export const BALANCE_STYLE = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
} as const;

export const BALANCE_LABEL_STYLE = {
  fontSize: "0.7rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  ...FAINT_TEXT_STYLE,
} as const;

export const BALANCE_VALUE_STYLE = {
  fontSize: "1.1rem",
  fontVariantNumeric: "tabular-nums",
} as const;

export const CAPTION_STYLE = {
  margin: 0,
  fontSize: "0.8rem",
  ...FAINT_TEXT_STYLE,
} as const;

export const RATES_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
} as const;

// Without flexWrap the full-width range span squeezes the label under the value instead of taking a second line.
export const RATE_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "0.5rem",
  fontVariantNumeric: "tabular-nums",
} as const;

/** The net line, ruled off from the rates below it that it sums. */
export const RATE_TOTAL_STYLE = {
  ...RATE_STYLE,
  borderBottom: "1px solid currentColor",
  paddingBottom: "0.25rem",
  marginBottom: "0.15rem",
} as const;

export const RATE_LABEL_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  fontSize: "0.85rem",
} as const;

export const RATE_VALUE_STYLE = { flex: "0 0 auto" } as const;

export const RATE_RANGE_STYLE = {
  flexBasis: "100%",
  fontSize: "0.75rem",
  ...FAINT_TEXT_STYLE,
} as const;

export const BREAKDOWN_LIST_STYLE = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.1rem",
} as const;

export const BREAKDOWN_ROW_STYLE = {
  display: "flex",
  gap: "0.5rem",
  fontSize: "0.8rem",
  fontVariantNumeric: "tabular-nums",
} as const;

export const BREAKDOWN_TERM_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  ...FAINT_TEXT_STYLE,
} as const;

export const BREAKDOWN_VALUE_STYLE = { margin: 0, flex: "0 0 auto" } as const;

export const MODEL_STYLE = {
  margin: 0,
  fontSize: "0.7rem",
  ...FAINT_TEXT_STYLE,
} as const;
