export const EMPTY_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-empty-note)",
} as const;

export const SUMMARY_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
} as const;

const CARD_MIN_WIDTH = "240px";

/**
 * Single column in portrait or square; in landscape an `auto-fill` grid whose
 * column count follows the width. Contracts separate at the section gap
 * because nothing else marks where one ends.
 */
export function cardListStyle(multiColumn: boolean) {
  if (!multiColumn) {
    return {
      display: "flex",
      flexDirection: "column",
      gap: "var(--gap-section)",
    } as const;
  }
  return {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}, 1fr))`,
    alignContent: "start",
    gap: "var(--gap-section)",
  } as const;
}

export const SECTION_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  marginTop: "var(--gap-list-heading)",
} as const;

export const OFFERED_ACTIONS_STYLE = {
  display: "flex",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-actions)",
} as const;

export const ACTIVE_ACTIONS_STYLE = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-actions)",
} as const;

export const DEADLINE_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
} as const;

export const AGENCY_STYLE = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
} as const;

/* A tight row gap keeps a wrapped third reward close under the first line. */
export const REWARDS_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-rewards)",
} as const;

export const REWARD_STYLE = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
} as const;

export const REWARD_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.1em",
  color: "var(--color-text-faint)",
} as const;

export const REWARD_VALUE_STYLE = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-accent-fg)",
  fontVariantNumeric: "tabular-nums",
} as const;

export const PARAMETERS_STYLE = {
  listStyle: "none",
  margin: "var(--gap-sub-readout) 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

export const PARAMETER_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
} as const;

export const OPTIONAL_STYLE = {
  color: "var(--color-text-faint)",
  fontStyle: "italic",
} as const;
