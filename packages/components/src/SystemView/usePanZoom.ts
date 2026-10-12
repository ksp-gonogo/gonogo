import { usePrefersReducedMotion } from "@ksp-gonogo/ui-kit";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWheelZoom } from "../shared/useWheelZoom";
import { EDGE_POINTER_INSET } from "./diagramMarks";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 25;

/** How much further than the parent body the widest view reaches, as a ratio of its distance. */
const PARENT_MARGIN = 1.15;

/**
 * Where the body the frame body orbits sits and how big the picture is, both in plot units at zoom 1.
 * The widest view is then wide enough to hold that body whatever the frame was fitted to.
 */
export interface ParentReach {
  /** How far the parent body is from the frame body. */
  parentAtPlotUnits: number;
  /** Half of the picture's shorter side. */
  halfPicturePlotUnits: number;
}

/**
 * The smallest zoom that keeps the parent body drawn as a dot, with a margin, from a view centred at `pan`.
 * A body closer than the fitted frame already shows needs no more than `MIN_ZOOM`, so the limit only ever widens.
 */
export function widestZoom(
  parent: ParentReach | null,
  pan: { x: number; y: number },
): number {
  if (parent === null || !(parent.parentAtPlotUnits > 0)) return MIN_ZOOM;
  const room = parent.halfPicturePlotUnits - EDGE_POINTER_INSET;
  if (!(room > 0)) return MIN_ZOOM;
  const needed =
    parent.parentAtPlotUnits * PARENT_MARGIN + Math.hypot(pan.x, pan.y);
  return Math.min(MIN_ZOOM, room / needed);
}

/** How long an eased change of view takes, in real milliseconds. */
const EASE_MS = 900;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Drag to pan and pinch to zoom about the centre, in viewBox user units; `enabled` binds the wheel only once there is something to zoom. */
export function usePanZoom(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  parent: ParentReach | null = null,
) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerMove = useCallback(
    (e: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      setPan({ x: drag.panX - dx, y: drag.panY - dy });
    },
    [zoom],
  );
  const [isDragging, setIsDragging] = useState(false);
  const [following, setFollowing] = useState(false);
  // The wheel's callback is memoised on `enabled`, so the live values it reads travel by ref.
  const live = useRef({ parent, pan });
  live.current = { parent, pan };
  const reducedMotion = usePrefersReducedMotion();
  const easing = useRef<number | null>(null);
  const stopEasing = useCallback(() => {
    if (easing.current !== null) cancelAnimationFrame(easing.current);
    easing.current = null;
  }, []);
  useEffect(() => stopEasing, [stopEasing]);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    return () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // Pinch-only wheel zoom (see `useWheelZoom`); the callback changes identity when bodies arrive so the listener binds once the container renders.
  useWheelZoom(
    containerRef,
    useMemo(
      () =>
        enabled
          ? // Zoom is about the diagram's centre, so the hook's pointer position is unused.
            (deltaY: number) => {
              stopEasing();
              const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
              const widest = widestZoom(live.current.parent, live.current.pan);
              // A view carried across a change of frame can sit outside the limits; a notch then moves it from where it is and never snaps it to one.
              setZoom((z) =>
                Math.max(
                  Math.min(widest, z),
                  Math.min(Math.max(MAX_ZOOM, z), z * factor),
                ),
              );
            }
          : null,
      [enabled, stopEasing],
    ),
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      stopEasing();
      setFollowing(false);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsDragging(true);
    },
    [pan, stopEasing],
  );

  const resetView = useCallback(() => {
    stopEasing();
    setFollowing(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [stopEasing]);

  /**
   * Moves the view from one zoom and centre to another over a short time, the zoom by equal ratios so the picture grows at a steady rate. A drag, a zoom notch or a reset takes over at once.
   * With `pan` left out of the target the centre is not driven, for a view that is following something. Under reduced motion the view is put at the target outright.
   */
  const easeView = useCallback(
    (
      from: { zoom: number; pan: { x: number; y: number } },
      to: { zoom: number; pan?: { x: number; y: number } },
    ) => {
      stopEasing();
      if (reducedMotion) {
        setZoom(to.zoom);
        if (to.pan !== undefined) setPan(to.pan);
        return;
      }
      const target = to.pan;
      // Timed off the frame clock alone, from the first frame it hands over: the two clocks a page has need not share a zero.
      let started: number | null = null;
      const step = (now: number) => {
        started ??= now;
        const t = Math.max(0, Math.min(1, (now - started) / EASE_MS));
        if (t >= 1) {
          // The target itself, never the arithmetic's last approach to it: a view a hair off the whole frame still offers Reset view.
          setZoom(to.zoom);
          if (target !== undefined) setPan(target);
          easing.current = null;
          return;
        }
        const e = easeInOut(t);
        setZoom(from.zoom * (to.zoom / from.zoom) ** e);
        if (target !== undefined) {
          setPan({
            x: from.pan.x + (target.x - from.pan.x) * e,
            y: from.pan.y + (target.y - from.pan.y) * e,
          });
        }
        easing.current = requestAnimationFrame(step);
      };
      easing.current = requestAnimationFrame(step);
    },
    [reducedMotion, stopEasing],
  );

  /** Puts the view at a zoom and centre outright, leaving `following` as it is: for a view carried over from another frame, which the zoom limits do not bind. */
  const setView = useCallback(
    (view: { zoom: number; pan: { x: number; y: number } }) => {
      setZoom(view.zoom);
      setPan(view.pan);
    },
    [],
  );

  /** Centres the view on a point in the diagram's own user units, keeping the zoom. While `following` is on, the diagram calls this each time the point moves. */
  const focusOn = useCallback((point: { x: number; y: number }) => {
    setPan({ x: point.x, y: point.y });
  }, []);

  return {
    zoom,
    pan,
    isDragging,
    following,
    setFollowing,
    handlePointerDown,
    resetView,
    setView,
    easeView,
    focusOn,
  };
}

export type PanZoom = ReturnType<typeof usePanZoom>;
