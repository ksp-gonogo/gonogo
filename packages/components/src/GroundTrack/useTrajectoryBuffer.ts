import { useTelemetryStoreOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef } from "react";
import {
  earliestFlightUt,
  storedTrail,
  TRAIL_BACKFILL_SECONDS,
} from "./storedTrail";
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
  /** Set on a point of a range the source holds that lies after the moment on screen. */
  ahead?: boolean;
};

const samePlace = (a: TrajectoryPoint, b: TrajectoryPoint) =>
  a.lat === b.lat && a.lon === b.lon && a.alt === b.alt;

/**
 * The flown trail: the newest `trajectoryLength` positions of one craft over
 * one body. `track` names whose trail it is, and a change of it restarts the
 * buffer, since a line from the last track's end to this one's start was never
 * flown.
 *
 * With a stream mounted, a restart (and the first mount) starts from the
 * positions the stream already holds for this track, so a map opened mid-flight
 * draws the stretch it missed. A screen that asks its history source for older
 * samples has the trail extended when they arrive.
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
  const seededRef = useRef(false);
  const oldestHeldUtRef = useRef(Number.POSITIVE_INFINITY);
  const store = useTelemetryStoreOptional();

  useEffect(() => {
    if (!store) return;
    const releaseFlight = store.holdWindow(
      "vessel.flight",
      TRAIL_BACKFILL_SECONDS,
    );
    const releaseIdentity = store.holdWindow(
      "vessel.identity",
      TRAIL_BACKFILL_SECONDS,
    );
    const stopWatching = store.subscribeFrame(() => {
      const oldest = earliestFlightUt(store);
      if (oldest >= oldestHeldUtRef.current) return;
      oldestHeldUtRef.current = oldest;
      trajectoryRef.current = storedTrail(store, trajectoryLengthRef.current);
      incrementTrajectoryCount();
    });
    return () => {
      stopWatching();
      releaseFlight();
      releaseIdentity();
    };
  }, [store, incrementTrajectoryCount]);

  const trajectoryLengthRef = useRef(trajectoryLength);
  trajectoryLengthRef.current = trajectoryLength;

  useEffect(() => {
    const seed = () => {
      if (!store) return;
      oldestHeldUtRef.current = earliestFlightUt(store);
      trajectoryRef.current = storedTrail(store, trajectoryLength);
    };
    if (!seededRef.current) {
      seededRef.current = true;
      seed();
    }
    if (seededRef.current && trackRef.current !== track) {
      trackRef.current = track;
      trajectoryRef.current.length = 0;
      seed();
      incrementTrajectoryCount();
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
    const last = buf[buf.length - 1];
    // The newest stored position is often the one in hand: it refreshes that point rather than doubling it.
    if (last && samePlace(last, point)) {
      Object.assign(last, point);
      incrementTrajectoryCount();
      return;
    }
    buf.push(point);
    while (buf.length > trajectoryLength) buf.shift();
    incrementTrajectoryCount();
  }, [
    lat,
    lon,
    altSea,
    trajectoryLength,
    track,
    store,
    mach,
    q,
    speed,
    vSpeed,
    incrementTrajectoryCount,
  ]);

  return { trajectoryRef, trajectoryCount };
}
