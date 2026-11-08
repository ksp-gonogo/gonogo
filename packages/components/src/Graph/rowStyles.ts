import type { CSSProperties } from "react";

/** Shared by every row in the series and threshold lists: one control strip per entry. */
export const ROW: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
  alignItems: "center",
  marginBottom: "var(--gap-related-compact)",
};
