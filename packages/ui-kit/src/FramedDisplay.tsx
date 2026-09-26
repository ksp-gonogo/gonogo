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
  /* Sunken: the visual sits inside the panel surface rather than floating on it. */
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  /* The container answers with a corner proportioned to the box, so a frame never needs to know its own size. */
  border-radius: var(--radius-display-frame);
  overflow: hidden;
  padding: ${({ $padded }) => ($padded ? "var(--inset-framed-display)" : "0")};

  /* A child SVG or canvas fills the frame instead of its intrinsic 300x150. */
  & > svg,
  & > canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;
