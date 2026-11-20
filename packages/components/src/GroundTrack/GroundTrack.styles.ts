import { FramedDisplay } from "@ksp-gonogo/ui";
import type { CSSProperties } from "react";
// biome-ignore lint/style/noRestrictedImports: the canvas's :active grab cursor and the compact rows' :has([data-unit-band]) wrap, which no inline style or kit primitive expresses
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
  letter-spacing: calc(0.05em * var(--tracking-scale));
`;

/* A fixed height, so a tag appearing or going never moves the map below by a fraction of a pixel. */
export const ToolbarRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  height: 24px;
`;

/* The stack of readout rows; `Panel fitToSize` supplies the fill and the centring. */
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
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: var(--color-text-faint);
  /* The three-letter labels are as wide as each other, so no floor is needed to align them; a floor takes room the figure and its mark need on the narrowest tile. */
  flex-shrink: 0;
  text-transform: uppercase;
`;

export const CompactValue = styled.span`
  /* Off the type scale: --font-size-base grows on a coarse pointer, and the figure never breaks. */
  font-size: 14px;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  /* A figure never breaks from its own symbol; the one break offered is before an interval. */
  white-space: nowrap;
  &:has([data-unit-band]) {
    white-space: normal;
  }
`;

/** Row container for the map canvas: one child, since augment panels float over the canvas via `ground-track.overlay`. */
export const MapBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--gap-related);
`;

/**
 * The frame around the map: visual content gets an edge while the augment
 * sections below keep the body inset. Unpadded because the fit view letterboxes
 * the 2:1 world and already carries dead space; a gutter would read as a
 * double border.
 */
export const MapFrame = styled(FramedDisplay)`
  flex: 1;
  min-height: 0;
  min-width: 0;
`;

/** Fills leftover space; the ResizeObserver measures it to size CanvasContainer. */
export const MapOuter = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

/** The map's frame; the width and height come inline in px so the canvas is exactly 2:1 whichever dimension binds. */
export const CANVAS_CONTAINER: CSSProperties = {
  flexShrink: 0,
  borderRadius: "var(--radius-regular)",
  overflow: "hidden",
};

const CanvasBase = styled.canvas`
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
`;

export const BaseCanvas = CanvasBase;
export const OverlayCanvas = CanvasBase;
/** A canvas drawn over the map's points of interest (the trail, the forward tracks and the vessel marker), pointer-inert so their markers stay reachable beneath it. */
export const DataCanvas = styled(CanvasBase)`
  pointer-events: none;
`;
export const PersistentDataCanvas = DataCanvas;
export const PredictionCanvas = DataCanvas;

/** The `ground-track.overlay` layer, over every canvas and pointer-inert; an augment re-enables pointer events on its own elements. */
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
  letter-spacing: calc(0.08em * var(--tracking-scale));
  text-transform: uppercase;
  pointer-events: none;
`;

/** A tick's own target on the map: large enough to find with a pointer, and a stop for the keyboard. Placed by `left` and `top` at the tick's centre. */
export const TrackEventTarget = styled.button`
  position: absolute;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  border-radius: var(--radius-circle);
  background: none;
  cursor: help;
  pointer-events: auto;

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;
