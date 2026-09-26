import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";

export interface FramedDisplayProps extends ComponentPropsWithoutRef<"div"> {
  children?: ReactNode;
  /**
   * Adds an inner gutter between the frame and its contents, for content that
   * carries no margin of its own.
   */
  padded?: boolean;
}

/**
 * A bordered, sunken box for visual content (SVG diagrams, canvases, maps,
 * gauges) inside an ordinary padded panel body, so readouts beside it keep the
 * standard inset and the diagram gets an edge that says where it ends.
 *
 * It does not scroll or size itself: the caller decides how much room the
 * visual gets. Sized with `flex: 1`, a tall flex sibling collapses it, so a
 * control belongs overlaid on the frame rather than beside it. The visual
 * fills to the rounded edge unless `padded`.
 */
export function FramedDisplay({
  children,
  padded,
  ...rest
}: FramedDisplayProps) {
  return (
    <FramedDisplay__Box $padded={padded} {...rest}>
      {children}
    </FramedDisplay__Box>
  );
}

const FramedDisplay__Box = styled.div<{ $padded?: boolean }>`
  position: relative;
  display: flex;
  min-height: 0;
  min-width: 0;
  /* Sunken rather than raised: the visual sits INSIDE the panel surface, and a
     raised box would read as a card floating on the panel, competing with the
     panel's own border for the eye. */
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  /* The corner is what separates a box that is LOOKED AT from a box that is
     READ. A frame and a card were both drawn at the regular 3px, so that
     distinction existed in this file's prose and nowhere in the pixels.

     The frame never knows its own size: a frame holding a map and a frame
     holding a 40px avatar both write this one name, and the container answers
     with a corner proportioned to the box it is giving them (a Block side
     aside re-declares it). A frame that measured itself would have to agree
     with its container about what "small" is, and the two would drift. */
  border-radius: var(--radius-display-frame);
  overflow: hidden;
  padding: ${({ $padded }) => ($padded ? "var(--inset-framed-display)" : "0")};

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
