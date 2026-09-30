import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";

export interface FramedDisplayProps extends ComponentPropsWithoutRef<"div"> {
  children?: ReactNode;
  /**
   * Adds an inner gutter between the frame and its contents, for content that
   * carries no margin of its own.
   */
  padded?: boolean;
  /**
   * A small label inlaid over the frame's own top-left corner, naming the
   * visual (which frame a drawing is in, what a gauge reads) on the drawing
   * itself instead of as a second body element beside it. A widget whose body
   * is otherwise nothing but this frame stays eligible for `Panel`'s
   * lone-frame inset rule, which a loose sibling caption breaks by giving the
   * body a second section. The caption sets its own type, the caption size
   * on a muted colour, so pass bare text rather than a sized `Text`, which
   * would override it. Undefined renders nothing.
   */
  caption?: ReactNode;
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
  caption,
  ...rest
}: FramedDisplayProps) {
  return (
    <FramedDisplay__Box $padded={padded} {...rest}>
      {children}
      {caption !== undefined && caption !== null && (
        <FramedDisplay__Caption>{caption}</FramedDisplay__Caption>
      )}
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

/*
 * An opaque backing in the frame's own surface, not a translucent scrim:
 * muted text over a scrim that lets a pale drawing through falls under 4.5:1.
 * Padded like GraphNotice's overlay pill, but pinned to the
 * frame's top-left rather than its bottom-left.
 *
 * Local sibling ordering inside this frame's own stacking context (the
 * caption over the drawing it labels), not app-global chrome, so the literal
 * z-index stays off the app's named rungs.
 */
const FramedDisplay__Caption = styled.div`
  position: absolute;
  top: var(--offset-frame-caption-top);
  left: var(--offset-frame-caption-left);
  z-index: 1;
  padding: var(--inset-notice-pill);
  border-radius: var(--radius-regular);
  /* The smallest rung, flush, so the label covers as little of the drawing as it can. */
  font-size: var(--font-size-caption);
  line-height: var(--line-height-flush);
  color: var(--color-text-muted);
  background: var(--color-surface-sunken);
  pointer-events: none;
`;
