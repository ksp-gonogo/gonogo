import { ScrollArea } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
// SectionsScroll styles ScrollArea's inner element, which no prop reaches; PowerRow is a passive row :hover.
// biome-ignore lint/style/noRestrictedImports: ScrollArea-internals selector and a passive row :hover, neither of which an inline style or a primitive can express
import styled from "styled-components";
import type { NetTone } from "./flow";

export const RESOURCE_SELECT: CSSProperties = {
  maxWidth: "50%",
  fontSize: "var(--font-size-value)",
  padding: "var(--inset-control)",
};

export const TOTALS: CSSProperties = {
  display: "grid",
  // 64px fits all four cells on one row at 6x8.
  gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-related-comfortable)",
  marginBottom: "var(--gap-related-comfortable)",
};

export const TOTALS_CELL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
};

export const MEASURED_CELL: CSSProperties = {
  border: "1px dashed var(--color-status-warning-bg)",
};

// On the NET cell's tinted background text-faint fails 4.5:1, so its label takes the tone's foreground (NET_LABEL_COLOUR).
export const CELL_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

export const CELL_VALUE: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "nowrap",
};

// An "amount / max" pair may wrap inside its narrow cell, breaking at the separator.
export const STORED_VALUE: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "normal",
  lineHeight: "var(--line-height-tight)",
};

export const SPARKLINE_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
  marginBottom: "var(--gap-related-comfortable)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
};

export const SPARKLINE_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  display: "inline-flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
  flexShrink: 0,
};

export const SPARKLINE_SUB: CSSProperties = { color: "var(--color-text-dim)" };

export const SPARKLINE_SLOT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
};

export const SectionsScroll = styled(ScrollArea)<{ $landscape?: boolean }>`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    /* This element stays the ScrollArea's scroller in both layouts, so nothing a short height cannot hold goes out of reach. */
    flex-direction: ${({ $landscape }) => ($landscape ? "row" : "column")};
    gap: ${({ $landscape }) => ($landscape ? "var(--gap-section-compact)" : "var(--gap-related-comfortable)")};
    ${({ $landscape }) => ($landscape ? "align-items: stretch;" : "")}
  }
`;

export const PANEL_SECTION_LANDSCAPE: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
};

export const SECTION_COUNT: CSSProperties = {
  marginLeft: "var(--gap-trailing-figure)",
  color: "var(--color-text-muted)",
};

export const SECTION_EMPTY: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  padding: "var(--inset-row)",
};

export const CONTRIB_LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
};

export const IDLE_LIST: CSSProperties = { ...CONTRIB_LIST, opacity: 0.55 };

export const PowerRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  font-size: var(--font-size-compact);
  background: var(--color-surface-app);
  border-radius: var(--radius-regular);
  &:hover {
    background: var(--color-surface-panel);
  }
`;

export const ROW_EFF: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  fontVariantNumeric: "tabular-nums",
};

export const HINT: CSSProperties = {
  marginTop: "var(--gap-related-compact)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  lineHeight: "var(--line-height-body)",
};

/** Text alignment for a compact resource name long enough to wrap; `Panel fitToSize` owns the centring. */
export const COMPACT_BODY: CSSProperties = {
  alignItems: "center",
  textAlign: "center",
};

export const COMPACT_RESOURCE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

// A literal 16px because --font-size-lg grows to 17px on coarse pointers, which clips "+49.50/s" in a 3x3 tile.
export const COMPACT_NET: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "16px",
  fontWeight: 700,
};

/** The NET cell's tint and edge per tone. */
export const NET_CELL_BY_TONE: Record<NetTone, CSSProperties> = {
  go: {
    background: "var(--color-status-go-bg)",
    border: "1px solid var(--color-status-go-bg)",
  },
  warn: {
    background: "var(--color-status-warning-bg-muted)",
    border: "1px solid var(--color-status-warning-bg)",
  },
  neutral: {
    background: "var(--color-surface-panel)",
    border: "1px solid var(--color-border-subtle)",
  },
};

/** The NET label's colour, which must hold 4.5:1 on its own cell's tint. */
export const NET_LABEL_COLOUR: Record<NetTone, string> = {
  go: "var(--color-status-go-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  neutral: "var(--color-text-faint)",
};
