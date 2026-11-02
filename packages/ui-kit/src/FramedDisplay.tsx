import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";
import { useElementSize } from "./useElementSize";

/**
 * An arc of a circular frame's border lit in a colour, growing outward from
 * the border by a share of its full reach. Useful for telling the operator
 * that something drawn inside the frame has gone past its edge, and which way:
 * the lit arc sits at the direction it left by and thickens as it goes further.
 * Passed to the `edgeCue` prop of {@link FramedDisplay}, which draws it on a
 * `"circle"` frame and ignores it on any other.
 *
 * @category Layout
 */
export interface EdgeCue {
  /** The direction of the arc's middle, in degrees turning counter-clockwise from the frame's right-hand point, so 90 is straight up. */
  angle: number;
  /** The arc's colour, as any CSS colour or a `var()` of a theme token. */
  colour: string;
  /** How far the arc has grown outward from the border, from 0 (a lit border) to 1 (its full reach). Outside that range it is held to it. */
  grow: number;
  /** The arc's length in degrees. Defaults to 90. */
  span?: number;
}

/**
 * Props for {@link FramedDisplay}. Any other `div` attribute passes through.
 * Useful for giving a diagram, plot or map a visible edge. Used by {@link
 * FramedDisplay}.
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
   * The frame's outline. `"rounded"`, the default, is the rounded rectangle
   * that fills the room it is given. `"circle"` is a disc: the caller gives it
   * one side (a `width`, or a `height`) and it keeps the other equal, so the
   * disc is as large as the room that side allows. A circle draws no `strip`,
   * and its `caption` and `footer` sit centred on the top and bottom edges
   * instead of in the corners, which the circle cuts away.
   */
  shape?: FramedDisplayShape;
  /**
   * Lights an arc of the border, or several, in a colour, each growing outward
   * from the border; see {@link EdgeCue}. Drawn only on `shape="circle"`. The
   * frame's own contents are still cut to the disc; the arcs are drawn outside
   * it, over the border and the room just beyond, so give the frame that room
   * in its layout. Omitted, nothing is drawn and the frame is laid out as it
   * was.
   */
  edgeCue?: EdgeCue | readonly EdgeCue[];
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

/**
 * The outline of a {@link FramedDisplay}: a rounded rectangle or a circle.
 * Useful for choosing how a drawing is cut, such as a magnifier view that
 * reads as a lens. Taken by the `shape` prop of {@link FramedDisplay}.
 *
 * @category Layout
 */
export type FramedDisplayShape = "rounded" | "circle";

const STRIP_MIN_PX = 24;
const STRIP_MAX_PX = 96;

/**
 * A bordered, sunken box for visual content (SVG diagrams, canvases, maps,
 * gauges) inside an ordinary padded panel body, so readouts beside it keep the
 * standard inset and the diagram has a visible edge. Useful for giving the
 * operator's diagram or plot a clear boundary. Used by the graph and docking
 * HUD widgets. A direct `svg` or `canvas` child fills the frame.
 *
 * It does not scroll or size itself: the caller decides how much room the
 * visual gets. It grows with `flex: 1`, so a tall flex sibling squeezes it;
 * overlay a control on the frame instead of placing it beside. The visual fills
 * to the rounded edge unless `padded`. A drawing and its trend share one frame
 * through `strip`. With `shape="circle"` it is a disc cut from a square the
 * caller sizes by one side.
 *
 * @category Layout
 */
export function FramedDisplay({
  children,
  padded,
  caption,
  footer,
  strip,
  shape = "rounded",
  edgeCue,
  ...rest
}: FramedDisplayProps) {
  const circle = shape === "circle";
  const cues = !circle || edgeCue === undefined ? [] : [edgeCue].flat();
  const hasStrip =
    !circle && strip !== undefined && strip !== null && strip !== false;
  return (
    <FramedDisplay__Box
      $padded={padded && !hasStrip}
      $stacked={hasStrip}
      $circle={circle}
      $cued={cues.length > 0}
      data-shape={shape}
      {...rest}
    >
      {cues.length > 0 && <FramedDisplay__Cues cues={cues} />}
      {hasStrip ? (
        <>
          <FramedDisplay__Main $padded={padded}>{children}</FramedDisplay__Main>
          <FramedDisplay__Strip data-framed-display-strip="">
            {strip}
          </FramedDisplay__Strip>
        </>
      ) : cues.length > 0 ? (
        <FramedDisplay__Clip>{children}</FramedDisplay__Clip>
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
  $circle?: boolean;
  $cued?: boolean;
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
  border-radius: ${({ $circle }) =>
    $circle ? "50%" : "var(--radius-display-frame)"};
  /* A cued circle clips its contents in a layer of its own, so the cue can grow outward past the border. */
  overflow: ${({ $cued }) => ($cued ? "visible" : "hidden")};
  padding: ${({ $padded }) => ($padded ? "var(--inset-framed-display)" : "0")};
  ${({ $circle }) =>
    $circle ? "aspect-ratio: 1 / 1; flex: none; align-self: center;" : ""}

  /* A child SVG or canvas fills the frame instead of its intrinsic 300x150. */
  & > svg,
  & > canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

/** A cued circle's contents, cut to the disc inside the border. */
const FramedDisplay__Clip = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  border-radius: 50%;
  overflow: hidden;

  & > svg,
  & > canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

/** Where the cue's arcs sit: the room beyond the border, in percent of the frame's side. */
const CUE_ROOM = 12;
/** The arc's thickness when it first lights and at full reach, in widths of the frame's own border. */
const CUE_MIN_BORDERS = 1;
const CUE_MAX_BORDERS = 3;
/** The frame's own border, pixels. */
const FRAME_BORDER_PX = 1;
/** The size of one border in a frame of 200 px, before the cue has been measured. */
const DEFAULT_BORDER_UNITS = (100 * FRAME_BORDER_PX) / 200;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * The path of one arc, as an annular sector in a 100-unit square with the
 * border on the circle of radius 50. `borderUnits` is the frame's border in
 * those units, which the arc's thickness is a multiple of.
 */
export function edgeCuePath(
  cue: EdgeCue,
  borderUnits = DEFAULT_BORDER_UNITS,
): string {
  const span = Math.min(Math.max(cue.span ?? 90, 1), 359);
  const grow = Math.min(
    Math.max(Number.isFinite(cue.grow) ? cue.grow : 0, 0),
    1,
  );
  const inner = 50;
  const borders = CUE_MIN_BORDERS + (CUE_MAX_BORDERS - CUE_MIN_BORDERS) * grow;
  const outer = 50 + borders * borderUnits;
  const a0 = toRad(cue.angle - span / 2);
  const a1 = toRad(cue.angle + span / 2);
  const at = (r: number, a: number) =>
    `${(50 + r * Math.cos(a)).toFixed(3)} ${(50 - r * Math.sin(a)).toFixed(3)}`;
  const large = span > 180 ? 1 : 0;
  // Counter-clockwise on screen is the sweep flag 0 with y down: out along the outer edge, back along the inner.
  return `M${at(inner, a0)}A${inner} ${inner} 0 ${large} 0 ${at(inner, a1)}L${at(outer, a1)}A${outer} ${outer} 0 ${large} 1 ${at(outer, a0)}Z`;
}

function FramedDisplay__Cues({ cues }: { cues: readonly EdgeCue[] }) {
  // The layer is wider than the frame by the room on each side; one border is a pixel of it.
  const { ref, size } = useElementSize<HTMLDivElement>({
    w: 100 + 2 * CUE_ROOM,
    h: 100 + 2 * CUE_ROOM,
  });
  const unitsPerPx = (100 + 2 * CUE_ROOM) / Math.max(size.w, 1);
  const borderUnits = FRAME_BORDER_PX * unitsPerPx;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: `${-CUE_ROOM}%`,
        top: `${-CUE_ROOM}%`,
        width: `${100 + 2 * CUE_ROOM}%`,
        height: `${100 + 2 * CUE_ROOM}%`,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <svg
        aria-hidden="true"
        data-edge-cues=""
        viewBox={`${-CUE_ROOM} ${-CUE_ROOM} ${100 + 2 * CUE_ROOM} ${100 + 2 * CUE_ROOM}`}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {cues.map((cue) => (
          <path
            key={`${cue.angle}-${cue.colour}`}
            data-edge-cue=""
            d={edgeCuePath(cue, borderUnits)}
            fill={cue.colour}
          />
        ))}
      </svg>
    </div>
  );
}

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

  /* A circle cuts the corners away, so its labels sit on the vertical axis. */
  [data-shape="circle"] > & {
    left: 50%;
    transform: translateX(-50%);
  }
`;

/** The caption's twin on the bottom edge: same backing and type, mirrored offsets. */
const FramedDisplay__Footer = styled(FramedDisplay__Caption)`
  top: auto;
  bottom: var(--offset-frame-footer-bottom);
  left: var(--offset-frame-footer-left);
`;
