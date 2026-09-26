import { useEffect, useRef } from "react";
import { WORLD_H, WORLD_W } from "./camera";
import { getTrajectoryStyle } from "./trajectoryStyle";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";

export function useWorldCanvas({
  trajectoryRef,
  trajectoryCount,
  adjustedMap,
  hasAtmosphere,
  maxAtmosphere,
  bodyName,
}: {
  trajectoryRef: React.MutableRefObject<TrajectoryPoint[]>;
  trajectoryCount: number;
  adjustedMap: (
    w: number,
    h: number,
    lat: number,
    lon: number,
  ) => { x: number; y: number };
  hasAtmosphere: boolean | undefined;
  maxAtmosphere: number | undefined;
  bodyName: string | undefined;
}) {
  // Offscreen trajectory canvas at WORLD_W by WORLD_H, so latLonToMap maps 1:1.
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // How far the canvas has been painted, so a burst of samples in one commit draws every segment, not just the tip.
  const lastDrawnCountRef = useRef(0);
  // Mirrors trajectoryCount so the body-switch effect fires on a body change only.
  const trajectoryCountRef = useRef(trajectoryCount);
  trajectoryCountRef.current = trajectoryCount;

  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = WORLD_W;
    c.height = WORLD_H;
    worldCanvasRef.current = c;
    return () => {
      worldCanvasRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: bodyName is the change trigger, not consumed in the body
  useEffect(() => {
    const canvas = worldCanvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, WORLD_W, WORLD_H);
    // Rebaseline: the buffer survives a body switch, and its old points must not redraw onto the cleared canvas.
    lastDrawnCountRef.current = trajectoryCountRef.current;
  }, [bodyName]);

  // Draw every buffered segment since the last paint, incrementally.
  useEffect(() => {
    if (trajectoryCount === 0) return;
    const canvas = worldCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const trajectory = trajectoryRef.current;
    const newPoints = trajectoryCount - lastDrawnCountRef.current;
    if (newPoints <= 0) return;

    // Points shifted out of the front since the last draw can no longer be painted.
    const segments = Math.min(newPoints, trajectory.length - 1);
    if (segments <= 0) {
      lastDrawnCountRef.current = trajectoryCount;
      return;
    }

    const startIdx = trajectory.length - 1 - segments;
    for (let i = startIdx; i < trajectory.length - 1; i++) {
      const p1 = trajectory[i];
      const p2 = trajectory[i + 1];
      if (!p1 || !p2) continue;

      const { x: x1, y: y1 } = adjustedMap(WORLD_W, WORLD_H, p1.lat, p1.lon);
      const { x: x2, y: y2 } = adjustedMap(WORLD_W, WORLD_H, p2.lat, p2.lon);

      const style = getTrajectoryStyle({
        alt: p2.alt,
        maxAtmosphere: maxAtmosphere ?? 100_000,
        hasAtmosphere: hasAtmosphere ?? false,
        q: p2.q,
        mach: p2.mach,
        speed: p2.speed,
        vSpeed: p2.vSpeed,
      });

      const [r, g, b] = style.color;
      ctx.strokeStyle = `rgba(${r},${g},${b},${style.alpha})`;
      ctx.lineWidth = style.width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    lastDrawnCountRef.current = trajectoryCount;
  }, [
    trajectoryCount,
    trajectoryRef,
    adjustedMap,
    hasAtmosphere,
    maxAtmosphere,
  ]);

  return worldCanvasRef;
}
