import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** A diagram's view: how far it is zoomed about its centre, and the point in plot units at its centre. */
export interface DiagramView {
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * The view that shows the same picture after the diagram changes the body it is centred on.
 *
 * A diagram's plot units start at its frame body and are scaled to fit that body's system, so the same zoom and pan mean a different place and a different size once the frame body changes. This carries a view across: every point keeps its place on screen and its metres per pixel, so the bodies and the craft do not move when the frame does.
 *
 * `previousFrameBodyAt` is where the body the diagram was centred on now sits, in metres from the new frame body, as the diagram places it.
 */
export function handoverView({
  view,
  previousScale,
  scale,
  previousFrameBodyAt,
}: {
  view: DiagramView;
  /** Metres to plot units before the change. */
  previousScale: number;
  /** Metres to plot units after it. */
  scale: number;
  previousFrameBodyAt: { x: number; y: number };
}): DiagramView {
  const ratio = scale / previousScale;
  return {
    zoom: view.zoom / ratio,
    pan: {
      x: view.pan.x * ratio + previousFrameBodyAt.x * scale,
      y: view.pan.y * ratio + previousFrameBodyAt.y * scale,
    },
  };
}

/** The view a frame mounts with: all of it, centred on its body. */
const WHOLE_FRAME: DiagramView = { zoom: 1, pan: { x: 0, y: 0 } };

/** How long the caption names the body the diagram was centred on before, in real milliseconds. */
const LEFT_FRAME_SHOWN_MS = 12_000;

/**
 * Carries the view across a change of frame that the craft caused, by passing from one body's sphere of influence into another's: the picture starts where it was and eases to the whole of the new frame. Reports the body the diagram was centred on for a short while afterwards.
 *
 * Only a frame that was following the craft before and after counts: a frame that changes because the widget was reconfigured, or because the craft's body was not yet known, is a different picture and the view is left alone.
 *
 * `placeOf` gives where a named body sits from the present frame body, in metres as the diagram places them, or null when the diagram cannot say; the view is then put back to the whole of the new frame, since nothing relates the two pictures.
 */
export function useFrameHandover({
  frameName,
  craftBodyName,
  plotScale,
  placeOf,
  view,
}: {
  frameName: string | null;
  /** The body the craft orbits, or null while that is not known. */
  craftBodyName: string | null;
  /** Metres to plot units at zoom 1 in the present frame, or null before there is a picture. */
  plotScale: number | null;
  placeOf: (bodyName: string) => { x: number; y: number } | null;
  view: DiagramView & {
    following: boolean;
    setView: (view: DiagramView) => void;
    easeView: (
      from: DiagramView,
      to: { zoom: number; pan?: { x: number; y: number } },
    ) => void;
  };
}): string | null {
  const last = useRef<{
    frame: string;
    scale: number;
    followedCraft: boolean;
  } | null>(null);
  const [leftFrame, setLeftFrame] = useState<string | null>(null);
  // Read at the change and never a reason to run it: the view moves on every drag and every followed frame.
  const live = useRef({ view, placeOf });
  live.current = { view, placeOf };

  // Before paint, so the first picture in the new frame is already the carried one.
  useLayoutEffect(() => {
    if (frameName === null || plotScale === null || !(plotScale > 0)) return;
    const previous = last.current;
    const followsCraft = craftBodyName === frameName;
    last.current = {
      frame: frameName,
      scale: plotScale,
      followedCraft: followsCraft,
    };
    if (previous === null || previous.frame === frameName) return;
    if (!previous.followedCraft || !followsCraft) return;
    const { view: now, placeOf: place } = live.current;
    const previousFrameBodyAt = place(previous.frame);
    if (previousFrameBodyAt === null) {
      now.setView(WHOLE_FRAME);
    } else {
      const carried = handoverView({
        view: { zoom: now.zoom, pan: now.pan },
        previousScale: previous.scale,
        scale: plotScale,
        previousFrameBodyAt,
      });
      now.setView(carried);
      // From the picture as it was to the whole of the new frame; a view that is following keeps its centre on what it follows.
      now.easeView(carried, now.following ? { zoom: 1 } : WHOLE_FRAME);
    }
    setLeftFrame(previous.frame);
  }, [frameName, craftBodyName, plotScale]);

  useEffect(() => {
    if (leftFrame === null) return;
    const timer = setTimeout(() => setLeftFrame(null), LEFT_FRAME_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [leftFrame]);

  return leftFrame;
}
