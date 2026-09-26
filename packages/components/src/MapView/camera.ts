export const WORLD_W = 4096;
export const WORLD_H = 2048;

// Maximum zoom relative to the fit-whole-world zoom.
const ZOOM_MAX_FACTOR = 20;

export type Camera = {
  zoom: number;
  panX: number; // world-space X at the screen centre
  panY: number; // world-space Y at the screen centre
};

export type ViewMode = "global" | "follow";

export const fitCamera = (screenW: number, screenH: number): Camera => ({
  zoom: Math.min(screenW / WORLD_W, screenH / WORLD_H),
  panX: WORLD_W / 2,
  panY: WORLD_H / 2,
});

export const worldToScreen = (
  wx: number,
  wy: number,
  camera: Camera,
  screenW: number,
  screenH: number,
) => ({
  x: (wx - camera.panX) * camera.zoom + screenW / 2,
  y: (wy - camera.panY) * camera.zoom + screenH / 2,
});

export const screenToWorld = (
  sx: number,
  sy: number,
  camera: Camera,
  screenW: number,
  screenH: number,
) => ({
  x: (sx - screenW / 2) / camera.zoom + camera.panX,
  y: (sy - screenH / 2) / camera.zoom + camera.panY,
});

// ctx.setTransform(...cameraTransform(camera, w, h)) puts the canvas in world space.
export const cameraTransform = (
  camera: Camera,
  screenW: number,
  screenH: number,
): [number, number, number, number, number, number] => [
  camera.zoom,
  0,
  0,
  camera.zoom,
  screenW / 2 - camera.panX * camera.zoom,
  screenH / 2 - camera.panY * camera.zoom,
];

// Relative to the fit zoom, so the operator cannot zoom out past the global view.
export const zoomBounds = (baseZoom: number) => ({
  min: baseZoom * 0.9,
  max: baseZoom * ZOOM_MAX_FACTOR,
});

// Follow-mode zoom from surface speed (m/s): slow is zoomed in, fast is the global view.
export const followZoom = (surfaceSpeed: number, baseZoom: number): number => {
  const t = Math.min(surfaceSpeed / 3000, 1);
  return baseZoom * (8 - 7 * t); // 8× at speed=0, 1× at speed≥3000 m/s
};
