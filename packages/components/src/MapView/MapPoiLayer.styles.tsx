import type { MapPoi } from "@ksp-gonogo/core";
import { IconButton } from "@ksp-gonogo/ui-kit";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

interface PoiKindStyle {
  background: string;
  border: string;
  borderStyle: "solid" | "dashed";
}

const KSC_STYLE: PoiKindStyle = {
  background: "var(--color-accent-fg)",
  border: "var(--color-accent-fg)",
  borderStyle: "solid",
};
const LAUNCH_SITE_STYLE: PoiKindStyle = {
  background: "var(--color-text-muted)",
  border: "var(--color-text-muted)",
  borderStyle: "solid",
};
const CONTRACT_ACTIVE_STYLE: PoiKindStyle = {
  background: "transparent",
  border: "var(--color-tag-yellow-fg)",
  borderStyle: "solid",
};
const CONTRACT_AVAILABLE_STYLE: PoiKindStyle = {
  background: "transparent",
  border: "var(--color-tag-yellow-fg)",
  borderStyle: "dashed",
};
const ANOMALY_STYLE: PoiKindStyle = {
  background: "var(--color-tag-cyan-fg)",
  border: "var(--color-tag-cyan-fg)",
  borderStyle: "solid",
};
// Neutral fallback so a third-party provider's novel `kind` still renders.
const DEFAULT_STYLE: PoiKindStyle = {
  background: "var(--color-text-faint)",
  border: "var(--color-text-faint)",
  borderStyle: "solid",
};

export function markerStyleFor(poi: MapPoi): PoiKindStyle {
  if (poi.kind === "contractTarget") {
    return poi.status === "active"
      ? CONTRACT_ACTIVE_STYLE
      : CONTRACT_AVAILABLE_STYLE;
  }
  switch (poi.kind) {
    case "ksc":
      return KSC_STYLE;
    case "launchSite":
      return LAUNCH_SITE_STYLE;
    case "anomaly":
      return ANOMALY_STYLE;
    default:
      return DEFAULT_STYLE;
  }
}

export const PoiLayerRoot = forwardRef<
  HTMLDivElement,
  Readonly<HTMLAttributes<HTMLDivElement>>
>(function PoiLayerRoot({ children, ...rest }, ref) {
  return (
    <div ref={ref} style={POI_LAYER_ROOT_STYLE} {...rest}>
      {children}
    </div>
  );
});

const POI_LAYER_ROOT_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

export function PoiMarkerButton({
  $style,
  style,
  ...rest
}: Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    $style: PoiKindStyle;
    style?: CSSProperties;
  }
>) {
  return (
    <IconButton
      style={{
        ...POI_MARKER_BUTTON_STYLE,
        background: $style.background,
        border: `2px ${$style.borderStyle} ${$style.border}`,
        ...style,
      }}
      {...rest}
    />
  );
}

const POI_MARKER_BUTTON_STYLE: CSSProperties = {
  position: "absolute",
  width: 10,
  height: 10,
  // Off the spacing ladder: half the marker size, centring it on its coordinate.
  margin: "-5px 0 0 -5px",
  padding: 0,
  borderRadius: "var(--radius-circle)",
  pointerEvents: "auto",
};

export function PoiHoverCard({
  children,
  ...rest
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div style={POI_HOVER_CARD_STYLE} {...rest}>
      {children}
    </div>
  );
}

const POI_HOVER_CARD_STYLE: CSSProperties = {
  minWidth: 160,
  maxWidth: 240,
  padding: "var(--inset-surface)",
  borderRadius: "var(--radius-regular)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface-raised)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-compact)",
};

export function PoiHoverLabel({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={POI_HOVER_LABEL_STYLE}>{children}</div>;
}

const POI_HOVER_LABEL_STYLE: CSSProperties = {
  fontWeight: 600,
  marginBottom: "var(--gap-caption)",
};

export function PoiHoverDetail({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={POI_HOVER_DETAIL_STYLE}>{children}</div>;
}

const POI_HOVER_DETAIL_STYLE: CSSProperties = {
  color: "var(--color-text-muted)",
  marginBottom: "var(--gap-sub-readout)",
};

export function PoiHoverCoords({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={POI_HOVER_COORDS_STYLE}>{children}</div>;
}

const POI_HOVER_COORDS_STYLE: CSSProperties = {
  color: "var(--color-text-dim)",
  marginBottom: "var(--gap-sub-readout)",
};

export function PoiHoverMetaRow({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={POI_HOVER_META_ROW_STYLE}>{children}</div>;
}

const POI_HOVER_META_ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--gap-related)",
};

export function PoiHoverActions({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <div style={POI_HOVER_ACTIONS_STYLE}>{children}</div>;
}

const POI_HOVER_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-card-actions)",
};
