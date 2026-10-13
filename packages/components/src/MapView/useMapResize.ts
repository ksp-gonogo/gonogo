import { useEffect, useState } from "react";

/**
 * `outerRef` is a callback ref: the frame only exists in the layouts large enough to draw a map, so the observer follows the element rather than the first render.
 */
export function useMapResize() {
  const [outer, outerRef] = useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    if (!outer) return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      /* The whole frame, not a 2:1 box inside it: the fit camera letterboxes the world at rest, and a zoomed-in map draws into the margins. */
      setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
    });

    obs.observe(outer);
    return () => obs.disconnect();
  }, [outer]);

  return { outerRef, containerSize };
}
