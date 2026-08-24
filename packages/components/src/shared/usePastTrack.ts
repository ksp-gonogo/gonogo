import {
  pastTrack,
  type TrajectoryPoint,
  useTelemetryStoreOptional,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";

/**
 * Where the craft has been over the last `windowSeconds`, from the samples the
 * store actually received.
 *
 * <p>A record rather than a prediction, which is why it reads history instead
 * of propagating the current elements backwards: an n-body path does not
 * retrace, so a backward solve would draw somewhere the craft has not been.</p>
 *
 * <p>Empty when no store is mounted, so a widget in the gallery or the probe
 * harness draws its forward arc and no trail rather than failing.</p>
 */
export function usePastTrack(
  windowSeconds: number,
  centreBodyIndex?: number,
): readonly TrajectoryPoint[] {
  const store = useTelemetryStoreOptional();
  const viewUt = useViewUt();
  // The frame's own instant, so the trail ends where the craft marker is. A
  // wall clock here would let the two disagree by however far the view is
  // scrubbed from now.
  const nowUt = viewUt?.magnitude;

  return useMemo(() => {
    if (!store || nowUt === undefined) return [];
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
      { centreBodyIndex },
    );
  }, [store, nowUt, windowSeconds, centreBodyIndex]);
}
