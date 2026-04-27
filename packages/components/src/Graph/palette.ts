export const GRAPH_PALETTE = [
  "var(--color-accent-fg)",
  "var(--color-tag-blue-fg)",
  "var(--color-status-warning-bg)",
  "var(--color-tag-purple-fg)",
  "var(--color-tag-red-fg)",
  "var(--color-tag-cyan-fg)",
  "var(--color-tag-yellow-fg)",
  "var(--color-tag-orange-fg)",
] as const;

export function paletteColor(index: number): string {
  return GRAPH_PALETTE[index % GRAPH_PALETTE.length];
}
