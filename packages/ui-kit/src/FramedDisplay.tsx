import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";

/**
 * Props for {@link FramedDisplay}. Any other `div` attribute passes through.
 *
 * @category Layout
 */
export interface FramedDisplayProps extends ComponentPropsWithoutRef<"div"> {
  /** The drawing the frame surrounds. */
  children?: ReactNode;
  /**
   * Adds an inner gutter between the frame and its contents, for content that
   * carries no margin of its own.
   */
  padded?: boolean;
  /**
   * A small label inlaid over the frame's top-left corner, naming the visual
   * (which frame a drawing is in, what a gauge reads) on the drawing itself.
   * Prefer it to a caption element beside the frame: a panel whose body holds
   * only this frame gives it a thinner inset when narrow, and a caption beside
   * it would cost that. The caption sets its own type (caption size, muted
   * colour), so pass bare text rather than a sized `Text`. Omitted, nothing is
   * drawn.
   */
  caption?: ReactNode;
  /**
   * A single line inlaid over the frame's bottom-left corner: a note or
   * status about what is drawn (an axis warning, a data age). Set on the same
   * opaque backing as `caption`; its colour is the caller's, so a warning can
   * pass a toned `Text`. Omitted, nothing is drawn.
   */
  footer?: ReactNode;
  /**
   * A band along the frame's bottom edge, inside the same border, for a trend
   * of the figure drawn above it. It is never padded: its content runs to the
   * frame's inner edges, while `padded` insets only the drawing above. Size
   * the content to the band (it takes three tenths of the frame's height,
   * within a minimum and a maximum) rather than giving the band a height. Omitted, the
   * frame is the one drawing.
   */
  strip?: ReactNode;
}

const STRIP_MIN_PX = 24;
const STRIP_MAX_PX = 96;

/**
 * A bordered, sunken box for visual content (SVG diagrams, canvases, maps,
 * gauges) inside an ordinary padded panel body, so readouts beside it keep the
 * standard inset and the diagram has a visible edge. A direct `svg` or
 * `canvas` child fills the frame.
 *
 * It does not scroll or size itself: the caller decides how much room the
 * visual gets. It grows with `flex: 1`, so a tall flex sibling squeezes it;
 * overlay a control on the frame rather than placing it beside. The visual
 * fills to the rounded edge unless `padded`. A drawing and its trend share one
 * frame through `strip` rather than two frames stacked.
 *
 * @category Layout
 */
export function FramedDisplay({
  children,
  padded,
  caption,
  footer,
  strip,
  ...rest
}: FramedDisplayProps) {
  const hasStrip = strip !== undefined && strip !== null && strip !== false;
  return (
    <FramedDisplay__Box
      $padded={padded && !hasStrip}
      $stacked={hasStrip}
      {...rest}
    >
      {hasStrip ? (
        <>
          <FramedDisplay__Main $padded={padded}>{children}</FramedDisplay__Main>
          <FramedDisplay__Strip data-framed-display-strip="">
            {strip}
          </FramedDisplay__Strip>
        </>
      ) : (
        children
      )}
      {caption !== undefined && caption !== null && (
        <FramedDisplay__Caption>{caption}</FramedDisplay__Caption>
      )}
      {footer !== undefined && footer !== null && (
        <FramedDisplay__Footer>{footer}</FramedDisplay__Footer>
      )}
    </FramedDisplay__Box>
  );
}

const FramedDisplay__Box = styled.div<{
  $padded?: boolean;
  $stacked?: boolean;
}>`
  position: relative;
  display: flex;
  flex-direction: ${({ $stacked }) => ($stacked ? "column" : "row")};
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

/** The drawing above a strip: it takes the height the strip leaves, and carries the frame's gutter itself so the strip stays flush. */
const FramedDisplay__Main = styled.div<{ $padded?: boolean }>`
  flex: 7 1 0;
  display: flex;
  min-height: 0;
  min-width: 0;
  padding: ${({ $padded }) => ($padded ? "var(--inset-framed-display)" : "0")};

  & > svg,
  & > canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

/**
 * Three parts in ten of the frame's height, floored so a trend stays legible
 * in a short frame and capped so it never outgrows the drawing it sits under.
 * A grow share, not a percentage height: a percentage does not resolve inside
 * a frame that is itself a stretched flex item, and the band then sizes to its
 * content.
 */
const FramedDisplay__Strip = styled.div`
  flex: 3 1 0;
  display: flex;
  min-height: ${STRIP_MIN_PX}px;
  max-height: ${STRIP_MAX_PX}px;
  min-width: 0;
  overflow: hidden;
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

/** The caption's twin on the bottom edge: same backing and type, mirrored offsets. */
const FramedDisplay__Footer = styled(FramedDisplay__Caption)`
  top: auto;
  bottom: var(--offset-frame-footer-bottom);
  left: var(--offset-frame-footer-left);
`;
