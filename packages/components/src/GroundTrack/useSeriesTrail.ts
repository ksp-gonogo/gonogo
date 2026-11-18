import { isValue } from "@ksp-gonogo/sitrep-sdk";
import {
  useTelemetryOverlay,
  useTelemetrySourceFor,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";

/* A sample read straight off the store: a decoded field is a Value, an undecoded one a bare number. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  return isValue(v) ? Number(v) : undefined;
}

/**
 * The trail as a series read from the store, for a subject whose whole path is
 * known at once (a design's prediction). `undefined` for the live vessel, whose
 * trail is still built sample by sample.
 */
export function useSeriesTrail():
  | {
      trajectoryRef: { current: TrajectoryPoint[] };
      trajectoryCount: number;
    }
  | undefined {
  const overlay = useTelemetryOverlay();
  const { store } = useTelemetrySourceFor("vessel.flight");
  const ref = useRef<TrajectoryPoint[]>([]);
  const designed = overlay?.mode === "design" && store !== undefined;
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribeFrame(cb) : () => {}),
    [store],
  );
  const held = useSyncExternalStore(subscribe, () =>
    store
      ? (store.sampleRange("vessel.flight", -Infinity, Infinity)?.length ?? 0)
      : 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `held` changes when the store fills, which is when the series must be read again
  const points = useMemo(() => {
    if (!designed || !store) return [];
    const range = store.sampleRange<Record<string, unknown>>(
      "vessel.flight",
      -Infinity,
      Infinity,
    );
    return (range ?? []).flatMap((point) => {
      const p = { payload: point.payload ?? {} };
      const lat = num(p.payload.latitude);
      const lon = num(p.payload.longitude);
      const alt = num(p.payload.altitudeAsl);
      return lat === undefined || lon === undefined || alt === undefined
        ? []
        : [{ lat, lon, alt, speed: num(p.payload.surfaceSpeed) }];
    });
  }, [designed, store, held]);
  if (!designed) return undefined;
  ref.current = points;
  return { trajectoryRef: ref, trajectoryCount: points.length };
}
