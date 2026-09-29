// Related gap, so two adjacent card borders do not read as one thick divider.
export const LIST_STYLE = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  gap: "var(--gap-related)",
} as const;

export const EMPTY_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  padding: "var(--inset-empty-roster)",
} as const;
