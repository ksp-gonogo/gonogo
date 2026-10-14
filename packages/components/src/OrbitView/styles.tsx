import type { AriaRole, CSSProperties, ReactNode } from "react";

export function NoData({
  children,
  role,
}: Readonly<{ children?: ReactNode; role?: AriaRole }>) {
  return (
    <div style={NO_DATA_STYLE} role={role}>
      {children}
    </div>
  );
}

const NO_DATA_STYLE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  padding: "var(--inset-empty-note)",
};

export function DiagramOverlayWrap({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={DIAGRAM_OVERLAY_WRAP_STYLE}>{children}</div>;
}

const DIAGRAM_OVERLAY_WRAP_STYLE: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: "flex",
};

export function OverlayLayer({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={OVERLAY_LAYER_STYLE}>{children}</div>;
}

// An overlay augment re-enables pointer events on its own elements.
const OVERLAY_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};
