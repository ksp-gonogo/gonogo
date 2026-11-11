import { useEffect, useRef, useState } from "react";

/** Time constant of the smoothing, in seconds: a step in the rate is about two thirds shown after this long. */
const SMOOTHING_SECONDS = 8;

/** How often the smoothed rate steps toward the latest one, in seconds. */
const TICK_SECONDS = 1;

/** A smoothed net rate (EC/s) whose size is under this reads as steady, so rounding noise never flips the direction. */
const STEADY_BELOW = 0.01;

export type ChargeTrendDirection = "charging" | "draining" | "steady";

export interface ChargeTrend {
  direction: ChargeTrendDirection;
  /** Seconds until the stored charge is empty at the smoothed drain; present only while draining with charge left. */
  secondsToEmpty: number | undefined;
  /** Seconds until the stored charge is full at the smoothed charge rate; present only while charging with room left. */
  secondsToFull: number | undefined;
  /** The store is already at capacity (charging) or already empty (draining), so there is no time to give. */
  atLimit: boolean;
}

/**
 * Whether the stored charge is rising, falling or level, and how long until it
 * is full or empty at that rate. Undefined while there is no smoothed rate or
 * no known stored amount and capacity, so an absent figure is never drawn as
 * zero or infinity.
 */
export function chargeTrend(
  smoothedRate: number | undefined,
  stored: number | undefined,
  capacity: number | undefined,
): ChargeTrend | undefined {
  if (smoothedRate === undefined || !Number.isFinite(smoothedRate)) {
    return undefined;
  }
  if (stored === undefined || !Number.isFinite(stored)) return undefined;
  if (capacity === undefined || !Number.isFinite(capacity)) return undefined;
  const none = { secondsToEmpty: undefined, secondsToFull: undefined };
  if (Math.abs(smoothedRate) < STEADY_BELOW) {
    return { direction: "steady", ...none, atLimit: false };
  }
  if (smoothedRate > 0) {
    const room = capacity - stored;
    return room > 0
      ? {
          direction: "charging",
          ...none,
          secondsToFull: room / smoothedRate,
          atLimit: false,
        }
      : { direction: "charging", ...none, atLimit: true };
  }
  return stored > 0
    ? {
        direction: "draining",
        ...none,
        secondsToEmpty: stored / -smoothedRate,
        atLimit: false,
      }
    : { direction: "draining", ...none, atLimit: true };
}

/** One exponential smoothing step from `previous` toward `next` over `elapsedSeconds`. */
export function smoothStep(
  previous: number,
  next: number,
  elapsedSeconds: number,
): number {
  const weight = 1 - Math.exp(-Math.max(0, elapsedSeconds) / SMOOTHING_SECONDS);
  return previous + (next - previous) * weight;
}

/**
 * The rate smoothed over a short window so a draw that flickers does not make
 * the time to empty jump. Seeded with the first rate it sees and dropped when
 * the rate goes absent, so a later figure starts fresh instead of blending
 * with a stale one.
 */
export function useSmoothedRate(rate: number | undefined): number | undefined {
  const [smoothed, setSmoothed] = useState(rate);
  const latest = useRef(rate);
  latest.current = rate;

  useEffect(() => {
    setSmoothed((prev) => {
      if (rate === undefined) return undefined;
      return prev === undefined ? rate : prev;
    });
  }, [rate]);

  const present = rate !== undefined;
  useEffect(() => {
    if (!present) return;
    const id = setInterval(() => {
      const target = latest.current;
      if (target === undefined) return;
      setSmoothed((prev) =>
        prev === undefined ? target : smoothStep(prev, target, TICK_SECONDS),
      );
    }, TICK_SECONDS * 1000);
    return () => clearInterval(id);
  }, [present]);

  return present ? smoothed : undefined;
}
