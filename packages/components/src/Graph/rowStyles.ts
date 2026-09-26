import type { CSSProperties } from "react";

/** Shared by every row in the series and threshold lists: one control strip per entry. */
export const ROW: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
  alignItems: "center",
  marginBottom: "var(--gap-related-compact)",
};

export const REMOVE_BUTTON: CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-lg)",
  lineHeight: "var(--line-height-flush)",
  padding: "var(--inset-glyph)",
  flexShrink: 0,
};
