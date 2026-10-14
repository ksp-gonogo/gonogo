import {
  type PanZoomCamera,
  usePanZoom as usePanZoomView,
  usePrefersReducedMotion,
} from "@ksp-gonogo/ui-kit";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EDGE_POINTER_INSET } from "./diagramMarks";

const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 25;

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

const HOME: PanZoomCamera = { zoom: 1, panX: 0, panY: 0 };

/**
 * The system diagram's view: pan and zoom from the shared diagram primitive, about the diagram's centre in viewBox user units, plus the eased moves, the follow and the focus the diagram adds.
 * `enabled` binds the gestures only once there is something to zoom, and `elementRef` is the element that takes them.
 */
export function usePanZoom(
  elementRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  parent: ParentReach | null = null,
) {
  const [following, setFollowing] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const easing = useRef<number | null>(null);
  const stopEasing = useCallback(() => {
    if (easing.current !== null) cancelAnimationFrame(easing.current);
    easing.current = null;
  }, []);
  useEffect(() => stopEasing, [stopEasing]);

  const view = usePanZoomView({
    elementRef,
    home: HOME,
    enabled,
    zoomAbout: "centre",
    // The widest view depends on where the view is centred, so the limit is read from the camera.
    minZoom: useCallback(
      (camera: PanZoomCamera) =>
        widestZoom(parent, { x: camera.panX, y: camera.panY }),
      [parent],
    ),
    maxZoom: MAX_ZOOM,
    onManualMove: useCallback(
      (kind: "pan" | "zoom" | "reset") => {
        stopEasing();
        if (kind !== "zoom") setFollowing(false);
      },
      [stopEasing],
    ),
  });
  const { camera, setCamera } = view;
  const pan = useMemo(
    () => ({ x: camera.panX, y: camera.panY }),
    [camera.panX, camera.panY],
  );
  const zoom = camera.zoom;

  const resetView = view.reset;

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
      const target = to.pan;
      const put = (z: number, p?: { x: number; y: number }) =>
        setCamera((prev) => ({
          zoom: z,
          panX: p?.x ?? prev.panX,
          panY: p?.y ?? prev.panY,
        }));
      if (reducedMotion) {
        put(to.zoom, target);
        return;
      }
      // Timed off the frame clock alone, from the first frame it hands over: the two clocks a page has need not share a zero.
      let started: number | null = null;
      const step = (now: number) => {
        started ??= now;
        const t = Math.max(0, Math.min(1, (now - started) / EASE_MS));
        if (t >= 1) {
          // The target itself, never the arithmetic's last approach to it: a view a hair off the whole frame still offers Reset view.
          put(to.zoom, target);
          easing.current = null;
          return;
        }
        const e = easeInOut(t);
        put(
          from.zoom * (to.zoom / from.zoom) ** e,
          target && {
            x: from.pan.x + (target.x - from.pan.x) * e,
            y: from.pan.y + (target.y - from.pan.y) * e,
          },
        );
        easing.current = requestAnimationFrame(step);
      };
      easing.current = requestAnimationFrame(step);
    },
    [reducedMotion, setCamera, stopEasing],
  );

  /** Puts the view at a zoom and centre outright, leaving `following` as it is: for a view carried over from another frame, which the zoom limits do not bind. */
  const setView = useCallback(
    (next: { zoom: number; pan: { x: number; y: number } }) => {
      setCamera({ zoom: next.zoom, panX: next.pan.x, panY: next.pan.y });
    },
    [setCamera],
  );

  /** Centres the view on a point in the diagram's own user units, keeping the zoom. While `following` is on, the diagram calls this each time the point moves. */
  const focusOn = useCallback(
    (point: { x: number; y: number }) => {
      setCamera((prev) => ({ ...prev, panX: point.x, panY: point.y }));
    },
    [setCamera],
  );

  return {
    zoom,
    pan,
    isDragging: view.isDragging,
    following,
    setFollowing,
    panZoom: view,
    resetView,
    setView,
    easeView,
    focusOn,
  };
}

export type PanZoom = ReturnType<typeof usePanZoom>;
