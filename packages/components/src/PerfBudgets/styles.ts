import type { CSSProperties } from "react";

export const LIST: CSSProperties = {
  listStyle: "none",
  // No top margin: Panel.Body supplies the inset and the gap between the title and the first row.
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

export const FOOTER: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-nogo-text)",
};

export const DOT_SUMMARY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  justifyContent: "center",
};

// Per-tone `color` is applied inline at the call site.
export const DOT_HEADLINE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  fontWeight: 700,
  letterSpacing: "0.04em",
};

export const DOT_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

// Per-tone `background` is applied inline at the call site.
export const DOT: CSSProperties = {
  width: "10px",
  height: "10px",
  borderRadius: "var(--radius-circle)",
};
