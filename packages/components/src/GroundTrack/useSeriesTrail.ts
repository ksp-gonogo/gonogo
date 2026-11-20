import { isValue } from "@ksp-gonogo/sitrep-sdk";
import {
  overlayCovers,
  useTelemetryOverlay,
  useTelemetrySourceFor,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { rangePart } from "@ksp-gonogo/ui-kit";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";

/* A sample read straight off the store: a decoded field is a Value, an undecoded one a bare number. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  return isValue(v) ? Number(v) : undefined;
}

/**
 * The trail as a range read from the store, for a craft whose whole path the
 * dashboard's mode holds at once: a recorded flight, a predicted one. Each
 * point says whether it lies after the moment on screen. `undefined` for the
 * live craft, whose trail is still built sample by sample.
 *
 * It asks nothing about which mode is on. A mode that answers for the craft
 * is read through the same range read a history plot uses, and that read
 * answers with everything the mode holds.
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
  const whole = overlayCovers(overlay, "vessel.flight") && store !== undefined;
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribeFrame(cb) : () => {}),
    [store],
  );
  const held = useSyncExternalStore(subscribe, () =>
    whole && store
      ? (store.sampleRange("vessel.flight", -Infinity, Infinity)?.length ?? 0)
      : 0,
  );
  // The moment on screen, to the second: the split between what has been reached and what is ahead moves with it.
  const atUt = useSyncExternalStore(subscribe, () =>
    whole && store ? Math.floor(store.clock.viewUt()) : 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `held` changes when the store fills, which is when the range must be read again
  const points = useMemo(() => {
    if (!whole || !store) return [];
    const range = store.sampleRange<Record<string, unknown>>(
      "vessel.flight",
      -Infinity,
      Infinity,
    );
    /*
     * A map is of one body, and a flight can change body. Only the stretch
     * about the body the craft is at, at the moment on screen, is this map's.
     */
    const orbits =
      store.sampleRange<Record<string, unknown>>(
        "vessel.orbit",
        -Infinity,
        Infinity,
      ) ?? [];
    const bodyAt = (ut: number): number | undefined => {
      let body: number | undefined;
      for (const orbit of orbits) {
        if (orbit.validAt > ut) break;
        body = num(orbit.payload?.referenceBodyIndex) ?? body;
      }
      return body;
    };
    const here = bodyAt(atUt + 1);
    return (range ?? []).flatMap((point): TrajectoryPoint[] => {
      if (bodyAt(point.validAt) !== here) return [];
      const payload = point.payload ?? {};
      const lat = num(payload.latitude);
      const lon = num(payload.longitude);
      const alt = num(payload.altitudeAsl);
      return lat === undefined || lon === undefined || alt === undefined
        ? []
        : [
            {
              lat,
              lon,
              alt,
              speed: num(payload.surfaceSpeed),
              ahead: rangePart(point.validAt, atUt + 1) === "ahead",
            },
          ];
    });
  }, [whole, store, held, atUt]);
  if (!whole) return undefined;
  ref.current = points;
  // The painter redraws when this number changes: on more points, and on the split moving.
  const reached = points.filter((p) => !p.ahead).length;
  return {
    trajectoryRef: ref,
    trajectoryCount: points.length * 1_000_000 + reached,
  };
}
