import { usePanZoom } from "@ksp-gonogo/ui-kit";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Camera,
  constrainCamera,
  fitCamera,
  type ViewMode,
  WORLD_H,
  WORLD_W,
  widestZoom,
  wrapWorldX,
  zoomBounds,
} from "./camera";

/** The map's view: pan and zoom from the shared diagram primitive, held inside the world, plus the follow mode and the refit on resize the map adds. */
export function useCamera(containerSize: { w: number; h: number } | null) {
  const baseZoom = containerSize ? widestZoom(containerSize.w) : 0.0001;
  const width = containerSize?.w;
  const height = containerSize?.h;
  const [viewMode, setViewMode] = useState<ViewMode>("global");
  const bounds = zoomBounds(baseZoom);

  // Every write is held inside the map, so a drag past a pole stops there instead of banking distance to drag back. The map repeats east and west, so a pan never ends: kept within one world, which draws the same.
  const constrain = useCallback(
    (next: Camera, size: { w: number; h: number }) => {
      const held = constrainCamera(next, size.w, size.h);
      return { ...held, panX: wrapWorldX(held.panX) };
    },
    [],
  );

  const view = usePanZoom({
    home: fitCamera(width ?? WORLD_W, height ?? WORLD_H),
    minZoom: bounds.min,
    maxZoom: bounds.max,
    zoomAbout: "pointer",
    constrain,
    // Any manual interaction exits follow mode.
    onManualMove: () => setViewMode("global"),
    enabled: containerSize !== null,
  });
  const { setCamera: setHeldCamera } = view;

  const setCamera = useCallback(
    (next: SetStateAction<Camera>) => setHeldCamera(next),
    [setHeldCamera],
  );

  // A resize lands one render before the effect that refits, and the held camera may be wider than the new tile allows.
  const camera = useMemo(
    () =>
      width === undefined || height === undefined
        ? view.camera
        : constrainCamera(view.camera, width, height),
    [view.camera, width, height],
  );

  // Reset to global fit on a resize, keyed on w/h so an identical new size object is a no-op.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional: react only to dimension changes, not object identity
  useEffect(() => {
    if (containerSize) setCamera(fitCamera(containerSize.w, containerSize.h));
  }, [containerSize?.w, containerSize?.h]);

  return {
    camera,
    setCamera,
    baseZoom,
    viewMode,
    setViewMode,
    panZoom: view,
  };
}
