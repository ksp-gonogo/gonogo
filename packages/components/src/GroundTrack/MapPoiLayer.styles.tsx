import type { MapPoi } from "@ksp-gonogo/core";
import {
  GroundStationIcon,
  IconButton,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useState,
} from "react";

interface PoiKindStyle {
  background: string;
  border: string;
  borderStyle: "solid" | "dashed";
  /** A dish on a mast for a place on the ground, a dot for everything else, so a pad never reads as the craft's own dot. */
  glyph?: "dish";
}

const KSC_STYLE: PoiKindStyle = {
  background: "var(--color-text-primary)",
  border: "var(--color-text-primary)",
  borderStyle: "solid",
  glyph: "dish",
};
const LAUNCH_SITE_STYLE: PoiKindStyle = {
  background: "var(--color-text-muted)",
  border: "var(--color-text-muted)",
  borderStyle: "solid",
  glyph: "dish",
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

/**
 * One map point's marker: a dish glyph for a place on the ground, a dot for
 * the rest. A plain button, since the shared hover card is its only tip.
 */
export const PoiMarkerButton = forwardRef<
  HTMLButtonElement,
  Readonly<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      $style: PoiKindStyle;
      style?: CSSProperties;
    }
  >
>(function PoiMarkerButton(
  {
    $style,
    style,
    "aria-label": label,
    onPointerEnter,
    onPointerLeave,
    ...rest
  },
  ref,
) {
  const dish = $style.glyph === "dish";
  const [hovered, setHovered] = useState(false);
  const raised = hovered || rest["aria-expanded"] === true;
  return (
    <IconButton
      ref={ref}
      style={{
        ...(dish ? POI_DISH_BUTTON_STYLE : POI_DOT_BUTTON_STYLE),
        ...(dish ? { color: $style.background } : null),
        transform: dish
          ? `translate(-50%, -50%)${raised ? " scale(1.25)" : ""}`
          : raised
            ? "scale(1.25)"
            : undefined,
        transition: "transform var(--duration-fast)",
        ...style,
      }}
      onPointerEnter={(event) => {
        setHovered(true);
        onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        setHovered(false);
        onPointerLeave?.(event);
      }}
      {...rest}
    >
      {label !== undefined && <VisuallyHidden>{label}</VisuallyHidden>}
      {dish ? (
        <span style={POI_DISH_GLYPH_STYLE}>
          <GroundStationIcon size="100%" />
        </span>
      ) : (
        <span
          style={{
            ...POI_DOT_STYLE,
            background: $style.background,
            border: `2px ${$style.borderStyle} ${$style.border}`,
          }}
        />
      )}
    </IconButton>
  );
});

/* The button is the 24 px hit area the kit's icon button enforces; the drawn marker is a smaller child centred in it. */
const POI_HIT_AREA = 24;

const POI_DOT_BUTTON_STYLE: CSSProperties = {
  position: "absolute",
  padding: 0,
  pointerEvents: "auto",
  width: POI_HIT_AREA,
  height: POI_HIT_AREA,
  margin: `${-POI_HIT_AREA / 2}px 0 0 ${-POI_HIT_AREA / 2}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
};

const POI_DOT_STYLE: CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: 10,
  height: 10,
  borderRadius: "var(--radius-circle)",
};

const POI_DISH_BUTTON_STYLE: CSSProperties = {
  position: "absolute",
  padding: 0,
  pointerEvents: "auto",
  width: POI_HIT_AREA,
  height: POI_HIT_AREA,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
};

const POI_DISH_GLYPH_STYLE: CSSProperties = {
  display: "block",
  width: 16,
  height: 16,
};

/**
 * The name of a contract waypoint, set below its ring and clear of the craft's
 * crosshair so it does not cover the craft beside it. A marker in the right
 * part of the map reads leftward, so the name stays on the map.
 */
export function PoiMapLabel({
  x,
  y,
  leftward,
  children,
}: Readonly<{
  x: number;
  y: number;
  leftward: boolean;
  children?: ReactNode;
}>) {
  return (
    <span
      aria-hidden="true"
      style={{
        ...POI_MAP_LABEL_STYLE,
        left: x,
        top: y + POI_LABEL_DROP,
        transform: leftward ? "translateX(-100%)" : undefined,
      }}
    >
      {children}
    </span>
  );
}

/** Below the craft's crosshair (12 px) and ring (6 px) with a little air, so a craft over the same point is not covered. */
const POI_LABEL_DROP = 14;

const POI_MAP_LABEL_STYLE: CSSProperties = {
  position: "absolute",
  maxWidth: 72,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  fontSize: "var(--font-size-caption)",
  color: "var(--color-tag-yellow-fg)",
};

export const PoiHoverCard = forwardRef<
  HTMLDivElement,
  Readonly<HTMLAttributes<HTMLDivElement>>
>(function PoiHoverCard({ children, ...rest }, ref) {
  return (
    <div ref={ref} style={POI_HOVER_CARD_STYLE} {...rest}>
      {children}
    </div>
  );
});

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
