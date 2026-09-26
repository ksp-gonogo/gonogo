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
      // 2:1 contain: fill the width unless that would exceed the available height.
      const cW = Math.floor(Math.min(width, height * 2));
      const cH = Math.floor(cW / 2);
      setContainerSize({ w: cW, h: cH });
    });

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { outerRef, containerSize };
}
