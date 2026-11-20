import { useEvents, useTelemetrySourceFor } from "@ksp-gonogo/sitrep-sdk/spine";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { type FlightQuantities, flightNumbers } from "./flightNumbers";
import { TrackEventTarget } from "./GroundTrack.styles";

const FLIGHT = "vessel.flight";
/** How far either side of an event's moment a place on the path may be taken from, in seconds. */
const NEAR_SECONDS = 5;
const TICK_PX = 9;

interface Place {
  ut: number;
  lat: number;
  lon: number;
}

function places(
  samples: readonly { validAt: number; payload: FlightQuantities | null }[],
): Place[] {
  return samples.flatMap((sample): Place[] => {
    const { lat, lon } = flightNumbers(sample.payload ?? undefined);
    return lat === undefined || lon === undefined
      ? []
      : [{ ut: sample.validAt, lat, lon }];
  });
}

/**
 * A tick across the craft's path at each event in the stretch the map draws,
 * such as a stage firing, with what happened on the tick. Each tick is a
 * button, so the pointer or the keyboard on it shows the words.
 */
export function TrackAnnotations({
  project,
}: {
  /** Where a latitude and longitude fall on the map, in its own pixels. */
  project: (lat: number, lon: number) => { x: number; y: number };
}) {
  const { store } = useTelemetrySourceFor(FLIGHT);
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribeFrame(cb) : () => {}),
    [store],
  );
  const held = useSyncExternalStore(subscribe, () =>
    store ? (store.sampleRange(FLIGHT, -Infinity, Infinity)?.length ?? 0) : 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `held` changes when the store holds another sample, which is when the range must be read again
  const path = useMemo<Place[]>(
    () =>
      places(
        store?.sampleRange<FlightQuantities>(FLIGHT, -Infinity, Infinity) ?? [],
      ),
    [store, held],
  );
  // The events of the stretch the path covers, which is the stretch the map draws.
  const events = useEvents(
    path[0]?.ut ?? Number.POSITIVE_INFINITY,
    path[path.length - 1]?.ut ?? Number.NEGATIVE_INFINITY,
  );

  const ticks = events.flatMap((event) => {
    let i = -1;
    for (let k = 0; k < path.length; k++) {
      if ((path[k]?.ut ?? Infinity) <= event.ut) i = k;
      else break;
    }
    const at = path[Math.max(i, 0)];
    if (!at || Math.abs(at.ut - event.ut) > NEAR_SECONDS) return [];
    const next = path[Math.max(i, 0) + 1] ?? path[Math.max(i, 0) - 1];
    const here = project(at.lat, at.lon);
    const there = next ? project(next.lat, next.lon) : undefined;
    // Across the path where its direction is known; level where the craft has not moved.
    const dx = there ? there.x - here.x : 0;
    const dy = there ? there.y - here.y : 0;
    const length = Math.hypot(dx, dy);
    const across =
      length > 0.01 ? { x: -dy / length, y: dx / length } : { x: 1, y: 0 };
    return [{ event, here, across }];
  });

  if (ticks.length === 0) return null;
  return (
    <div
      data-track-annotations
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {ticks.map(({ event, here, across }) => (
          <line
            key={`${event.ut}:${event.label}`}
            x1={here.x - across.x * TICK_PX}
            y1={here.y - across.y * TICK_PX}
            x2={here.x + across.x * TICK_PX}
            y2={here.y + across.y * TICK_PX}
            stroke="var(--color-text-primary)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
      </svg>
      {ticks.map(({ event, here }) => (
        <Tooltip
          key={`${event.ut}:${event.label}`}
          text={event.label}
          announce={false}
        >
          <TrackEventTarget
            type="button"
            aria-label={event.label}
            data-track-event={event.label}
            style={{ left: here.x, top: here.y }}
          />
        </Tooltip>
      ))}
    </div>
  );
}
