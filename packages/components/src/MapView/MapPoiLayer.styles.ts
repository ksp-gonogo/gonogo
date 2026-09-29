import type { MapPoi } from "@ksp-gonogo/core";
import styled from "styled-components";

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

export const PoiLayerRoot = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

export const PoiMarkerButton = styled.button<{ $style: PoiKindStyle }>`
  position: absolute;
  width: 10px;
  height: 10px;
  /* Off the spacing ladder: half the marker size, centring it on its coordinate. */
  margin: -5px 0 0 -5px;
  padding: 0;
  border-radius: var(--radius-circle);
  cursor: pointer;
  pointer-events: auto;
  background: ${({ $style }) => $style.background};
  border: 2px ${({ $style }) => $style.borderStyle} ${({ $style }) => $style.border};

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

export const PoiHoverCard = styled.div`
  min-width: 160px;
  max-width: 240px;
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
`;

export const PoiHoverLabel = styled.div`
  font-weight: 600;
  margin-bottom: var(--gap-caption);
`;

export const PoiHoverDetail = styled.div`
  color: var(--color-text-muted);
  margin-bottom: var(--gap-sub-readout);
`;

export const PoiHoverCoords = styled.div`
  color: var(--color-text-dim);
  margin-bottom: var(--gap-sub-readout);
`;

export const PoiHoverMetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--gap-related);
`;

export const PoiHoverActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
  margin-top: var(--gap-card-actions);
`;
