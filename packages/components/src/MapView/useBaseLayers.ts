import { onAugmentsChange } from "@ksp-gonogo/core";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The canvases `map-view.base` augments hand back, and which suppressing
 * augments have a live Domain. Both live in refs; `version` is what triggers
 * the redraw.
 */
export function useBaseLayers() {
  // Keyed by each contributing augment's own id.
  const canvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [version, setVersion] = useState(0);
  const onLayer = useCallback(
    (id: string, canvas: HTMLCanvasElement | null, _version: number) => {
      if (canvas) canvasesRef.current.set(id, canvas);
      else canvasesRef.current.delete(id);
      // An own counter rather than the caller's version: two augments in the same millisecond could hand back the same number and React would skip the render.
      setVersion((v) => v + 1);
    },
    [],
  );

  // Registry presence is not the Domain being live.
  const suppressionAvailabilityRef = useRef<Map<string, boolean>>(new Map());
  const onSuppressAvailabilityChange = useCallback(
    (id: string, available: boolean) => {
      if (available) suppressionAvailabilityRef.current.set(id, true);
      else suppressionAvailabilityRef.current.delete(id);
      setVersion((v) => v + 1);
    },
    [],
  );

  // The probe list is read from the registry at render time, so an augment registered after mount needs this to get a probe.
  useEffect(() => onAugmentsChange(() => setVersion((v) => v + 1)), []);

  return {
    canvasesRef,
    suppressionAvailabilityRef,
    version,
    onLayer,
    onSuppressAvailabilityChange,
  };
}
