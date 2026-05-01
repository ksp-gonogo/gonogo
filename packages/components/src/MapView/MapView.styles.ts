import styled from "styled-components";

export const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
`;

export const BodyLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
`;

export const CompactReadout = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-height: 0;
`;

export const CompactRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`;

export const CompactLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
  min-width: 28px;
  text-transform: uppercase;
`;

export const CompactValue = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

/**
 * Fills leftover space. The ResizeObserver measures this element's actual
 * content rect and computes letterboxed pixel dimensions for CanvasContainer.
 */
export const MapOuter = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

/**
 * Sized explicitly via inline style (width/height in px) so the canvas is
 * always exactly 2:1 regardless of which dimension is the bottleneck.
 */
export const CanvasContainer = styled.div`
  position: relative;
  flex-shrink: 0;
  border-radius: 2px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
`;

const CanvasBase = styled.canvas`
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
`;

export const BaseCanvas = CanvasBase;
export const OverlayCanvas = CanvasBase;
export const DataCanvas = CanvasBase;
export const PersistentDataCanvas = CanvasBase;
export const PredictionCanvas = CanvasBase;

export const NoSignal = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
`;

export const PredictionChip = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 8px;
  background: rgba(80, 40, 120, 0.8);
  color: var(--color-tag-purple-fg);
  border: 1px solid var(--color-tag-purple-border);
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  pointer-events: none;
  border-radius: 2px;
`;

export const ImagingChip = styled.span<{ $variant: "on" | "off" | "warn" }>`
  padding: 2px 6px;
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 2px;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "on"
        ? "var(--color-status-go-bg)"
        : $variant === "warn"
          ? "var(--color-tag-yellow-border)"
          : "var(--color-border-subtle)"};
  background: ${({ $variant }) =>
    $variant === "on"
      ? "rgba(40, 120, 60, 0.3)"
      : $variant === "warn"
        ? "rgba(120, 100, 40, 0.3)"
        : "rgba(40, 40, 40, 0.3)"};
  color: ${({ $variant }) =>
    $variant === "on"
      ? "var(--color-status-go-fg)"
      : $variant === "warn"
        ? "var(--color-tag-yellow-fg)"
        : "var(--color-text-muted)"};
`;

export const TelemetryPanel = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding-top: 4px;
  border-top: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

export const TelRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

export const TelKey = styled.span<{ $colour: string }>`
  font-size: var(--font-size-xs);
  color: ${({ $colour }) => $colour};
  opacity: 0.6;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const TelValue = styled.span<{ $colour: string }>`
  font-size: 12px;
  font-weight: 600;
  color: ${({ $colour }) => $colour};
  font-variant-numeric: tabular-nums;
  min-width: 7ch;
  white-space: nowrap;
`;
