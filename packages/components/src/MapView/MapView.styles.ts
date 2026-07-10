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
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  /* Numeric readout — never truncate digits. Shrink to fit the row instead
     of overflowing the panel edge at the 3-col minimum size. */
  min-width: 0;
  white-space: nowrap;
`;

/**
 * Row container for the map + the optional anomaly side-panel: panel
 * beside the map. The panel is gated off below 8 cols (see index.tsx
 * `showAnomalySide`), so at the narrow sizes where a column reflow would
 * help, the side-panel isn't rendered at all and the map keeps the full
 * width.
 */
export const MapBody = styled.div<{ $stack?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: ${(p) => (p.$stack ? "column" : "row")};
  gap: 8px;
`;

/**
 * Fills leftover space. The ResizeObserver measures this element's actual
 * content rect and computes letterboxed pixel dimensions for CanvasContainer.
 */
export const MapOuter = styled.div<{ $stack?: boolean }>`
  /* Stacked (tall/square): pin to a 2:1 box at full width so the map fills it
     edge-to-edge and the panel below takes the leftover height — no vertical
     letterbox. Beside the panel (landscape): grow to fill leftover space. */
  ${(p) =>
    p.$stack ? "flex: 0 0 auto; width: 100%; aspect-ratio: 2 / 1;" : "flex: 1;"}
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

// ── Anomaly side-panel (C) ──────────────────────────────────────────────────

export const AnomalyPanel = styled.aside<{ $stack?: boolean }>`
  /* Beside the map: a fixed-width column. Below the map (stacked): full width,
     absorbing the leftover height and scrolling its multi-column list. */
  ${(p) =>
    p.$stack
      ? "width: 100%; max-width: none; flex: 1 1 0;"
      : "flex: 0 0 auto; width: 140px; max-width: 40%;"}
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
`;

export const AnomalyPanelTitle = styled.h3`
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0;
`;

export const AnomalyPanelList = styled.ul<{ $stack?: boolean }>`
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 3px;
  /* Beside the map: a single tall column. Below the map: flow into as many
     columns as the width allows so the list uses the horizontal space. */
  ${(p) =>
    p.$stack
      ? "display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));"
      : "display: flex; flex-direction: column;"}
`;

export const AnomalyPanelItem = styled.li`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    "name dist"
    "name bearing";
  align-items: baseline;
  column-gap: 6px;
  padding: 3px 6px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

export const AnomalyPanelName = styled.span`
  grid-area: name;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  align-self: center;
`;

export const AnomalyPanelDist = styled.span`
  grid-area: dist;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

export const AnomalyPanelBearing = styled.span`
  grid-area: bearing;
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

// ── Coverage readout (B) ─────────────────────────────────────────────────────

export const CoveragePanel = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--color-surface-raised);
`;

export const CoverageScanner = styled.div`
  display: grid;
  grid-template-columns: 48px 1fr 40px auto;
  align-items: center;
  gap: 6px;
`;

export const CoverageTrack = styled.div<{ $pct: number }>`
  height: 5px;
  border-radius: 3px;
  background: var(--color-surface-raised);
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: ${({ $pct }) => `${Math.max(0, Math.min(100, $pct))}%`};
    background: var(--color-accent-fg);
  }
`;

export const CoverageChip = styled.span<{ $variant: "best" | "in" | "idle" }>`
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: right;
  min-width: 4ch;
  color: ${({ $variant }) =>
    $variant === "best"
      ? "var(--color-status-go-fg)"
      : $variant === "in"
        ? "var(--color-status-info-fg)"
        : "var(--color-text-faint)"};
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

/**
 * Absolutely-positioned layer stacked over the map canvases for the
 * `map-view.overlay` augment slot (Uplink architecture spec §4.8). Sits on
 * top of every canvas (last DOM child) yet stays out of the map's pointer
 * path, so an empty slot is visually and interactively inert; an overlay
 * augment re-enables pointer events on its own elements when it needs them.
 */
export const OverlayAugmentLayer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

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
