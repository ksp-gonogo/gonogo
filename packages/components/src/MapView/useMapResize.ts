import { useEffect, useRef, useState } from "react";

export function useMapResize() {
  const outerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      /* The whole frame, not a 2:1 box inside it: the fit camera letterboxes the world at rest, and a zoomed-in map draws into the margins. */
      setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
    });

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { outerRef, containerSize };
}
