import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWheelZoom } from "../shared/useWheelZoom";
import {
  type Camera,
  fitCamera,
  type ViewMode,
  WORLD_H,
  WORLD_W,
  zoomBounds,
} from "./camera";

interface PointerPos {
  x: number;
  y: number;
}

export function useCamera(containerSize: { w: number; h: number } | null) {
  const baseZoom = containerSize
    ? Math.min(containerSize.w / WORLD_W, containerSize.h / WORLD_H)
    : 0.0001;

  const [camera, setCamera] = useState<Camera>(() =>
    fitCamera(containerSize?.w ?? WORLD_W, containerSize?.h ?? WORLD_H),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("global");

  const interactionRef = useRef<HTMLDivElement | null>(null);

  // Keyed by pointerId to track multi-touch pinches.
  const activePointers = useRef<Map<number, PointerPos>>(new Map());
  // Reset on transitions in and out of pinch so the pan does not jump.
  const lastPanPos = useRef<PointerPos | null>(null);
  // Pointer distance on the previous move, for a frame-to-frame pinch zoom ratio.
  const lastPinchDist = useRef<number | null>(null);

  // Reset to global fit on a resize, keyed on w/h so an identical new size object is a no-op.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional: react only to dimension changes, not object identity
  useEffect(() => {
    if (containerSize) setCamera(fitCamera(containerSize.w, containerSize.h));
  }, [containerSize?.w, containerSize?.h]);

  // Wheel zoom on the pinch gesture only (see `useWheelZoom`), bound once the container is measured.
  useWheelZoom(
    interactionRef,
    useMemo(
      () =>
        containerSize
          ? (deltaY: number, mx: number, my: number) => {
              const { w, h } = containerSize;
              setViewMode("global"); // any manual interaction exits follow mode
              setCamera((prev) => {
                const { min, max } = zoomBounds(baseZoom);
                const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
                const newZoom = Math.max(
                  min,
                  Math.min(max, prev.zoom * factor),
                );
                // Keep the world point under the cursor fixed during zoom
                const wx = (mx - w / 2) / prev.zoom + prev.panX;
                const wy = (my - h / 2) / prev.zoom + prev.panY;
                return {
                  zoom: newZoom,
                  panX: wx - (mx - w / 2) / newZoom,
                  panY: wy - (my - h / 2) / newZoom,
                };
              });
            }
          : null,
      [containerSize, baseZoom],
    ),
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Transitioning from 1→2 pointers: drop pan anchor, arm pinch baseline.
    if (activePointers.current.size === 2) {
      lastPanPos.current = null;
      const [a, b] = [...activePointers.current.values()];
      lastPinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (activePointers.current.size !== 1) return;
    lastPanPos.current = { x: e.clientX, y: e.clientY };
    lastPinchDist.current = null;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const tracked = activePointers.current.get(e.pointerId);
      if (!tracked) return;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size >= 2) {
        const el = interactionRef.current;
        if (!el || !containerSize) return;
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
        const { w, h } = containerSize;

        setViewMode("global");
        setCamera((prev) => {
          const { min, max } = zoomBounds(baseZoom);
          const newZoom = Math.max(min, Math.min(max, prev.zoom * ratio));
          const wx = (mx - w / 2) / prev.zoom + prev.panX;
          const wy = (my - h / 2) / prev.zoom + prev.panY;
          return {
            zoom: newZoom,
            panX: wx - (mx - w / 2) / newZoom,
            panY: wy - (my - h / 2) / newZoom,
          };
        });
        return;
      }

      // Single-pointer pan.
      if (!lastPanPos.current) return;
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      setViewMode("global");
      setCamera((prev) => ({
        ...prev,
        panX: prev.panX - dx / prev.zoom,
        panY: prev.panY - dy / prev.zoom,
      }));
    },
    [baseZoom, containerSize],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (activePointers.current.size === 1) {
      // Pinch ended but one finger remains: re-anchor pan so it doesn't jump.
      const [remaining] = [...activePointers.current.values()];
      lastPanPos.current = { ...remaining };
      lastPinchDist.current = null;
      return;
    }
    if (activePointers.current.size !== 0) return;
    lastPanPos.current = null;
    lastPinchDist.current = null;
  }, []);

  return {
    camera,
    setCamera,
    baseZoom,
    viewMode,
    setViewMode,
    interactionRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };
}
