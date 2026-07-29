import styled from "styled-components";

export const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-8);
`;

export const BodyLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
`;

export const CompactReadout = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-4);
  min-height: 0;
`;

export const CompactRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
`;

export const CompactLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
  min-width: 28px;
  text-transform: uppercase;
`;

export const CompactValue = styled.span`
  /* Off the type scale: --font-size-base is 15px on a coarse pointer, and
     this value is nowrap with nothing left to give (see the note below), so
     the bump is width the row does not have at the 3-col minimum size. */
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  /* Numeric readout: never truncate digits. Shrink to fit the row instead
     of overflowing the panel edge at the 3-col minimum size. */
  min-width: 0;
  white-space: nowrap;
`;

/**
 * Row container for the map canvas. (Used to also lay out the anomaly
 * side-panel beside/below the map, that panel moved into the
 * `AnomalyOverlay` augment, which floats over the canvas via `map-view.overlay`
 * instead of reserving row/column layout space here, so this is now a plain
 * flex row with one child.)
 */
export const MapBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-8);
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
 * Below-content panel host for the `map-view.sections` slot, one panel per
 * registered augment, composed additively by priority exactly like
 * `objectives.sections`/`power-systems.sections`. Renders nothing (adds no
 * DOM) when the slot is empty; augments that return `null` add no DOM
 * either, so this stays visually inert until something registers.
 */
export const MapSections = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

/**
 * Sized explicitly via inline style (width/height in px) so the canvas is
 * always exactly 2:1 regardless of which dimension is the bottleneck.
 */
export const CanvasContainer = styled.div`
  position: relative;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
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
 * `map-view.overlay` augment slot. Sits on
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

export const ImagingChip = styled.span<{ $variant: "on" | "off" | "warn" }>`
  padding: var(--space-2) var(--space-6);
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: var(--radius-xs);
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
