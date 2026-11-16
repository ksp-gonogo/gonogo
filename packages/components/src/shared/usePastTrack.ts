import { PerfBudget } from "@ksp-gonogo/core";
import {
  buildElements,
  pastTrack,
  type TrajectoryPoint,
  useTelemetryStoreOptional,
  useViewUt,
  type WireOrbitElements,
} from "@ksp-gonogo/sitrep-client";
import { useMemo, useRef } from "react";

/**
 * A full window is about twelve hundred samples at the mod's four a second, and
 * a change of the frame solves them all once. A solve per sample per frame would
 * be tens of thousands.
 */
const PAST_TRACK_SOLVE_BUDGET = new PerfBudget({
  name: "usePastTrack sample solves/sec",
  threshold: 1500,
  windowMs: 1000,
  unit: "solves",
});

type Orbit = WireOrbitElements & { referenceBodyIndex?: number };

/** What one stored sample contributes to the trail: a break, nothing, or a point. */
type Solved = "break" | "skip" | TrajectoryPoint;

interface SolvedSamples {
  frameKey: string;
  bySample: WeakMap<object, Solved>;
  last: readonly TrajectoryPoint[];
}

/**
 * Where the craft has been over the last `windowSeconds`, from received
 * samples in `orbit`'s frame; never a backward solve, since an n-body path does
 * not retrace. Empty when no store is mounted.
 */
export function usePastTrack(
  windowSeconds: number,
  orbit: Orbit | undefined,
): readonly TrajectoryPoint[] {
  const store = useTelemetryStoreOptional();
  const viewUt = useViewUt();
  // The view's instant, not the wall clock, so the trail ends at the craft marker.
  const nowUt = viewUt?.magnitude;
  const solved = useRef<SolvedSamples | null>(null);
  /* The points are placed in the perifocal frame of these angles, so they are what a cached point depends on besides its own sample. */
  const frameKey =
    orbit === undefined
      ? undefined
      : (() => {
          const { inc, lan, argPe } = buildElements(orbit);
          return `${inc}|${lan}|${argPe}|${orbit.referenceBodyIndex}`;
        })();

  return useMemo(() => {
    if (!store || nowUt === undefined || orbit === undefined) return [];
    const samples = store.sampleRange<Record<string, unknown>>(
      "vessel.orbit",
      nowUt - windowSeconds,
      nowUt,
    );
    if (!samples) return [];
    let cache = solved.current;
    if (cache === null || cache.frameKey !== frameKey) {
      cache = { frameKey: frameKey ?? "", bySample: new WeakMap(), last: [] };
      solved.current = cache;
    }
    const options = { frame: orbit, centreBodyIndex: orbit.referenceBodyIndex };
    /*
     * The trail is rebuilt from per-sample results so that sliding the window
     * solves only the samples that arrived since the last frame. `pastTrack`
     * decides what a lone sample is; the two cases it ends the trail on are
     * restated here because a lone call cannot tell them from a dropped sample.
     */
    const points: TrajectoryPoint[] = [];
    for (const sample of samples) {
      const payload = sample.payload as Orbit | null;
      if (payload === null) {
        points.length = 0;
        continue;
      }
      let result = cache.bySample.get(payload);
      if (result === undefined) {
        PAST_TRACK_SOLVE_BUDGET.record();
        result =
          options.centreBodyIndex !== undefined &&
          payload.referenceBodyIndex !== undefined &&
          payload.referenceBodyIndex !== options.centreBodyIndex
            ? "break"
            : (pastTrack([{ payload, validAt: sample.validAt }], options)[0] ??
              "skip");
        cache.bySample.set(payload, result);
      }
      if (result === "break") {
        points.length = 0;
        continue;
      }
      if (result !== "skip") points.push(result);
    }
    const unchanged =
      points.length === cache.last.length &&
      points.every((point, i) => point === cache.last[i]);
    if (unchanged) return cache.last;
    cache.last = points;
    return points;
  }, [store, nowUt, windowSeconds, orbit, frameKey]);
}
