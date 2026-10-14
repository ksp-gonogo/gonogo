import type { TopicReading } from "./reading";
import { useStream } from "./use-stream";

/**
 * One craft's link figures as the command centre last heard them, read off
 * `trackingStation.vessel.<guid>.link`. Display only.
 *
 * `oneWaySeconds` is a bare number, not a wrapped `Value<"s">` like the generated
 * `TrackingStationVesselLink` contract type: a per-craft Topic is dynamic, and the
 * decode path cannot unit-wrap it (`wrapTopicPayload` keys on the exact topic
 * string and a per-guid topic matches no entry in the unit maps), so every field
 * arrives as the raw wire number.
 */
export interface TrackedVesselLink {
  /** One-way signal delay to the vessel, seconds (bare wire number). null/absent when no path. */
  oneWaySeconds?: number | null;
  /** Whether the vessel is currently reachable. */
  connected: boolean;
}

/** The delay and connectivity of craft `guid` as the command centre last heard them, as a reading. */
export function useTrackedVesselLink(
  guid: string,
): TopicReading<TrackedVesselLink> {
  return useStream<TrackedVesselLink>(`trackingStation.vessel.${guid}.link`);
}
