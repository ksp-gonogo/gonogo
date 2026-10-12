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

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 25;

/** Drag to pan and pinch to zoom about the centre, in viewBox user units; `enabled` binds the wheel only once there is something to zoom. */
export function usePanZoom(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
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
              const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
              // A view carried across a change of frame can sit outside the limits; a notch then moves it from where it is and never snaps it to one.
              setZoom((z) =>
                Math.max(
                  Math.min(MIN_ZOOM, z),
                  Math.min(Math.max(MAX_ZOOM, z), z * factor),
                ),
              );
            }
          : null,
      [enabled],
    ),
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      setFollowing(false);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsDragging(true);
    },
    [pan],
  );

  const resetView = useCallback(() => {
    setFollowing(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

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
    focusOn,
  };
}

export type PanZoom = ReturnType<typeof usePanZoom>;
