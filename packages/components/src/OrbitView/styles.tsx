import { Stack } from "@ksp-gonogo/ui-kit";
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

export function PillFill({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={PILL_FILL_STYLE}>{children}</div>;
}

const PILL_FILL_STYLE: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
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

/**
 * The landscape branch's sidebar content: body name and status pill, stacked
 * and vertically centred in the narrow column `panelSidebar` reserves beside
 * the diagram.
 */
export function LandscapeChrome({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <Stack style={LANDSCAPE_CHROME_STYLE}>{children}</Stack>;
}

const LANDSCAPE_CHROME_STYLE: CSSProperties = {
  justifyContent: "center",
  minWidth: 0,
  minHeight: 0,
};
