import { FramedDisplay } from "@ksp-gonogo/ui";
import styled from "styled-components";

export const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--gap-related);
`;

export const BodyLabel = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
`;

/* The fill and the centring are `Panel fitToSize`'s now; what is left here is
   the stack of readout rows itself. */
export const CompactReadout = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const CompactRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  /* Only a row carrying an interval wraps; any other row keeps its label beside the figure. */
  &:has([data-unit-band]) {
    flex-wrap: wrap;
  }
`;

export const CompactLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
  min-width: 28px;
  text-transform: uppercase;
`;

export const CompactValue = styled.span`
  /* Off the type scale: --font-size-base grows on a coarse pointer, and the figure never breaks. */
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  /* A figure never breaks from its own symbol; the one break offered is before an interval. */
  white-space: nowrap;
  &:has([data-unit-band]) {
    white-space: normal;
  }
`;

/** Row container for the map canvas: one child, since augment panels float over the canvas via `map-view.overlay`. */
export const MapBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gap-related);
`;

/**
 * The frame around the map: visual content gets an edge while the augment
 * sections below keep the body inset. `flush` because the map is letterboxed
 * to 2:1 and already carries dead space; a gutter would read as a double border.
 */
export const MapFrame = styled(FramedDisplay)`
  flex: 1;
  min-height: 0;
  min-width: 0;
`;

/** Fills leftover space; the ResizeObserver measures it to letterbox CanvasContainer. */
export const MapOuter = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

/** Host for the `map-view.sections` slot; adds no DOM when the slot is empty. */
export const MapSections = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

/** Sized by inline width/height in px so the canvas is exactly 2:1 whichever dimension binds. */
export const CanvasContainer = styled.div`
  position: relative;
  flex-shrink: 0;
  border-radius: var(--radius-regular);
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

/** The `map-view.overlay` layer, over every canvas and pointer-inert; an augment re-enables pointer events on its own elements. */
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
  font-size: var(--font-size-caption);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
`;

export const ImagingChip = styled.span<{ $variant: "on" | "off" | "warn" }>`
  padding: var(--inset-chip);
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: var(--radius-regular);
  border: 1px solid
    ${({ $variant }) =>
      $variant === "on"
        ? "var(--color-status-go-mark)"
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
