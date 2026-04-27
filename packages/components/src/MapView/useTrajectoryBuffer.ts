import { useEffect, useRef } from "react";
import { useTrajectoryCount } from "./useTrajectoryCount";

export type TrajectoryPoint = {
  lat: number;
  lon: number;
  alt: number;
  q: number;
  mach: number;
  speed: number;
  vSpeed: number;
};

export function useTrajectoryBuffer({
  lat,
  lon,
  altSea,
  q,
  mach,
  speed,
  vSpeed,
  trajectoryLength,
}: {
  lat: number | undefined;
  lon: number | undefined;
  altSea: number | undefined;
  q: number | undefined;
  mach: number | undefined;
  speed: number | undefined;
  vSpeed: number | undefined;
  trajectoryLength: number;
}) {
  const { trajectoryCount, incrementTrajectoryCount } = useTrajectoryCount();
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);

  useEffect(() => {
    if (lat === undefined || lon === undefined || altSea === undefined) return;
    const point: TrajectoryPoint = {
      lat,
      lon,
      alt: altSea,
      q: q ?? 0,
      mach: mach ?? 0,
      speed: speed ?? 0,
      vSpeed: vSpeed ?? 0,
    };

    // Mutate the existing array instead of slicing + spreading. Spread
    // copied the entire backing array on every sample (~2 KB × 2 = 4 KB
    // per Telemachus tick at default trajectoryLength=2000); push + shift
    // does one append + one head-shift, ~half the moves and zero allocations.
    const buf = trajectoryRef.current;
    buf.push(point);
    while (buf.length > trajectoryLength) buf.shift();
    incrementTrajectoryCount();
  }, [
    lat,
    lon,
    altSea,
    trajectoryLength,
    mach,
    q,
    speed,
    vSpeed,
    incrementTrajectoryCount,
  ]);

  return { trajectoryRef, trajectoryCount };
}
