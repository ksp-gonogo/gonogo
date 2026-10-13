import { useEffect, useRef } from "react";
import { useTrajectoryCount } from "./useTrajectoryCount";

export type TrajectoryPoint = {
  lat: number;
  lon: number;
  alt: number;
  /** Dynamic pressure, kPa; absent when the flight record did not carry it. */
  q?: number;
  mach?: number;
  speed?: number;
  vSpeed?: number;
};

/**
 * The flown trail: the newest `trajectoryLength` positions of one craft over
 * one body. `track` names whose trail it is, and a change of it empties the
 * buffer, since a line from the last track's end to this one's start was never
 * flown.
 */
export function useTrajectoryBuffer({
  lat,
  lon,
  altSea,
  q,
  mach,
  speed,
  vSpeed,
  trajectoryLength,
  track,
}: {
  lat: number | undefined;
  lon: number | undefined;
  altSea: number | undefined;
  q: number | undefined;
  mach: number | undefined;
  speed: number | undefined;
  vSpeed: number | undefined;
  trajectoryLength: number;
  track: string | undefined;
}) {
  const { trajectoryCount, incrementTrajectoryCount } = useTrajectoryCount();
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);
  const trackRef = useRef(track);

  useEffect(() => {
    if (trackRef.current !== track) {
      trackRef.current = track;
      // The position in hand may still be the last track's, so this one starts at the next.
      if (trajectoryRef.current.length > 0) {
        trajectoryRef.current.length = 0;
        incrementTrajectoryCount();
      }
      return;
    }
    if (lat === undefined || lon === undefined || altSea === undefined) return;
    const point: TrajectoryPoint = {
      lat,
      lon,
      alt: altSea,
      q,
      mach,
      speed,
      vSpeed,
    };

    // Mutated in place: push and shift allocate nothing, where a spread copied the whole buffer every sample.
    const buf = trajectoryRef.current;
    buf.push(point);
    while (buf.length > trajectoryLength) buf.shift();
    incrementTrajectoryCount();
  }, [
    lat,
    lon,
    altSea,
    trajectoryLength,
    track,
    mach,
    q,
    speed,
    vSpeed,
    incrementTrajectoryCount,
  ]);

  return { trajectoryRef, trajectoryCount };
}
