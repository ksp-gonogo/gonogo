import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface PointerPos {
  x: number;
  y: number;
}

export interface ZoomPanCamera {
  zoom: number;
  panX: number;
  panY: number;
}

export interface UseZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  /** Movement in screen px before a single-pointer drag counts as a pan. */
  panThreshold?: number;
  /** Multiplier per wheel notch (notch up zooms in by this factor). */
  wheelStep?: number;
}

const DEFAULTS = {
  minScale: 0.5,
  maxScale: 12,
  panThreshold: 4,
  wheelStep: 1.15,
};

/**
 * Screen-space pan + zoom + pinch gesture state for SVG/HTML diagrams whose
 * transform is applied as `translate(panX, panY) scale(zoom)`. The (panX,
 * panY) values are in screen pixels — they translate the rendered content,
 * they are not a world offset. zoomAbout keeps the screen point under the
 * cursor pinned through scale changes.
 */
export function useZoomPan<E extends HTMLElement = HTMLDivElement>(
  options: UseZoomPanOptions = {},
) {
  const minScale = options.minScale ?? DEFAULTS.minScale;
  const maxScale = options.maxScale ?? DEFAULTS.maxScale;
  const panThreshold = options.panThreshold ?? DEFAULTS.panThreshold;
  const wheelStep = options.wheelStep ?? DEFAULTS.wheelStep;

  const [cam, setCam] = useState<ZoomPanCamera>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  const ref = useRef<E>(null);
  const activePointers = useRef<Map<number, PointerPos>>(new Map());
  const lastPanPos = useRef<PointerPos | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  // Read from JSX for cursor styling — kept as a ref intentionally.
  const panMoved = useRef(false);

  const reset = useCallback(() => setCam({ zoom: 1, panX: 0, panY: 0 }), []);

  const zoomAbout = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      setCam((prev) => {
        const newZoom = Math.max(
          minScale,
          Math.min(maxScale, prev.zoom * factor),
        );
        if (newZoom === prev.zoom) return prev;
        const worldX = (screenX - prev.panX) / prev.zoom;
        const worldY = (screenY - prev.panY) / prev.zoom;
        return {
          zoom: newZoom,
          panX: screenX - worldX * newZoom,
          panY: screenY - worldY * newZoom,
        };
      });
    },
    [minScale, maxScale],
  );

  // Native wheel listener: React's onWheel is passive in some setups, so
  // preventDefault would silently fail. Attach with { passive: false }.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? wheelStep : 1 / wheelStep;
      zoomAbout(factor, mx, my);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout, wheelStep]);

  const onPointerDown = useCallback((e: React.PointerEvent<E>) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panMoved.current = false;
    if (activePointers.current.size === 2) {
      lastPanPos.current = null;
      const [a, b] = [...activePointers.current.values()];
      lastPinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    } else if (activePointers.current.size === 1) {
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      lastPinchDist.current = null;
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<E>) => {
      const tracked = activePointers.current.get(e.pointerId);
      if (!tracked) return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size >= 2) {
        const el = ref.current;
        if (!el) return;
        const [a, b] = [...activePointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinchDist.current === null || lastPinchDist.current === 0) {
          lastPinchDist.current = dist;
          return;
        }
        const ratio = dist / lastPinchDist.current;
        lastPinchDist.current = dist;
        const rect = el.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - rect.left;
        const my = (a.y + b.y) / 2 - rect.top;
        panMoved.current = true;
        zoomAbout(ratio, mx, my);
        return;
      }

      if (!lastPanPos.current) return;
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      if (!panMoved.current && Math.hypot(dx, dy) < panThreshold) return;
      panMoved.current = true;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      setCam((prev) => ({
        ...prev,
        panX: prev.panX + dx,
        panY: prev.panY + dy,
      }));
    },
    [zoomAbout, panThreshold],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<E>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 1) {
      const [remaining] = [...activePointers.current.values()];
      lastPanPos.current = { ...remaining };
      lastPinchDist.current = null;
    } else if (activePointers.current.size === 0) {
      lastPanPos.current = null;
      lastPinchDist.current = null;
    }
  }, []);

  return {
    ref,
    cam,
    setCam,
    reset,
    zoomAbout,
    panMoved,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave: onPointerUp,
    },
  };
}
