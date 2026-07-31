import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";

/**
 * A bordered, sunken box for VISUAL content: SVG diagrams, canvases, maps,
 * gauges. Anything whose job is to be looked at rather than read.
 *
 * This exists so that padding can be universal. Panel pads its body, which is
 * right for text and wrong for a diagram that wants to fill the space, and the
 * obvious fix (an opt-out that cancels the inset for one child) was rejected
 * for a better reason than tidiness: almost no widget is wholly visual. They
 * are mixed. A diagram sits beside readouts, and an all-or-nothing container
 * flag forces the widget to choose, which is exactly how one widget ended up
 * with an unpadded data list next to its chart.
 *
 * Framing the visual instead of unpadding the panel makes the mixed case the
 * easy one: the readouts keep the standard inset, and the diagram gets an edge
 * that says where it ends. In a widget with a sidebar the frame also does the
 * dividing, so no separate rule is needed.
 *
 * It deliberately does NOT scroll or size itself. The caller decides how much
 * room the visual gets, because only the caller knows whether the diagram or
 * the numbers beside it should win when space is short.
 */
export interface FramedDisplayProps extends ComponentPropsWithoutRef<"div"> {
  children?: ReactNode;
  /**
   * Removes the inner gutter between the frame and its contents. For a visual
   * that already carries its own margin (most SVGs with a viewBox do) the
   * gutter reads as a double border.
   */
  flush?: boolean;
}

export function FramedDisplay({
  children,
  flush,
  ...rest
}: FramedDisplayProps) {
  return (
    <FramedDisplay__Box $flush={flush} {...rest}>
      {children}
    </FramedDisplay__Box>
  );
}

const FramedDisplay__Box = styled.div<{ $flush?: boolean }>`
  position: relative;
  display: flex;
  min-height: 0;
  min-width: 0;
  /* Sunken rather than raised: the visual sits INSIDE the panel surface, and a
     raised box would read as a card floating on the panel, competing with the
     panel's own border for the eye. */
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  padding: ${({ $flush }) => ($flush ? "0" : "var(--space-4)")};

  /* A child SVG or canvas fills the frame. Without this an SVG with no
     explicit size renders at its intrinsic 300x150 and floats in the corner,
     which looks like a bug rather than a layout choice. */
  & > svg,
  & > canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;
