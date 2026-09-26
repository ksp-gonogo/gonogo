import type { CSSProperties } from "react";

export const FRAME_CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
  flex: "0 0 auto",
};

export const COMPACT_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--gap-related)",
};

export const COMPACT_VALUE: CSSProperties = {
  // Off the type scale: the scale stops at --font-size-lg (16px) and this is a display-tier readout.
  fontSize: "22px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

export const COMPACT_SUB: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
};

// Flush: SystemDiagram reserves its own padding inside the viewBox, and the frame's edge separates it from the sidebar.
export const DIAGRAM_FRAME: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

export const DIAGRAM_WRAP: CSSProperties = {
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
};

export const OVERLAY_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Keep the diagram beneath interactive (pan/zoom/hover); an overlay augment re-enables pointer events on its own elements when it needs them.
  pointerEvents: "none",
};
