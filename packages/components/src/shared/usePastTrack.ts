import {
  pastTrack,
  type TrajectoryPoint,
  useTelemetryStoreOptional,
  useViewUt,
  type WireOrbitElements,
} from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";

/**
 * Where the craft has been over the last `windowSeconds`, from received
 * samples in `orbit`'s frame; never a backward solve, since an n-body path does
 * not retrace. Empty when no store is mounted.
 */
export function usePastTrack(
  windowSeconds: number,
  orbit: (WireOrbitElements & { referenceBodyIndex?: number }) | undefined,
): readonly TrajectoryPoint[] {
  const store = useTelemetryStoreOptional();
  const viewUt = useViewUt();
  // The view's instant, not the wall clock, so the trail ends at the craft marker.
  const nowUt = viewUt?.magnitude;

  return useMemo(() => {
    if (!store || nowUt === undefined || orbit === undefined) return [];
    const samples = store.sampleRange<Record<string, unknown>>(
      "vessel.orbit",
      nowUt - windowSeconds,
      nowUt,
    );
    if (!samples) return [];
    return pastTrack(
      samples.map((point) => ({
        payload: point.payload as never,
        validAt: point.validAt,
      })),
      { frame: orbit, centreBodyIndex: orbit.referenceBodyIndex },
    );
  }, [store, nowUt, windowSeconds, orbit]);
}
