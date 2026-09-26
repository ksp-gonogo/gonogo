import { BAND_COLOR, type Band } from "./bands";

export const PILL_ROW_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;

/* `minWidth: 0` lets the pill shrink so "CRITICAL" ellipsises instead of overflowing at the 3-column minimum; the padding is deliberately tighter than the base StatusPill. */
export const COMPACT_PILL_STYLE = {
  minWidth: 0,
  maxWidth: "100%",
  padding: "5px 10px",
  letterSpacing: "0.06em",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

export const CRITICAL_NOTE_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-status-nogo-fg)",
  letterSpacing: "0.04em",
} as const;

// Owned by the parent so a group that does not render leaves no gap.
export const READOUT_GROUPS_STYLE = {
  gap: "var(--gap-readout-groups)",
} as const;

// Label and band badge share the top line so the band reads as a top-right badge.
export const ROW_HEADER_STYLE = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--gap-related)",
} as const;

export const ROW_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--color-text-dim)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

export const ROW_BODY_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

export const TEMP_READOUT_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "var(--gap-readout-row) var(--gap-value-tag)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
} as const;

/** Temp value stays intact rather than breaking "287.5°C" mid-token. */
export const TEMP_VALUE_STYLE = { whiteSpace: "nowrap" } as const;

export const MAX_TAG_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  whiteSpace: "nowrap",
} as const;

/** The band badge takes its colour from the band it reports. */
export function bandTagStyle(band: Band) {
  return {
    flexShrink: 0,
    fontSize: "var(--font-size-caption)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: BAND_COLOR[band],
  } as const;
}
