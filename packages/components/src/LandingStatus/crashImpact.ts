import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { greatCircle } from "./geo";

/** Where a crashed vessel came to rest, measured from the last place the stream put it. */
export interface CrashImpact {
  /** Ground distance from the last reading to the crash site, metres. */
  distanceMeters: number;
  /** Bearing from the last reading to the crash site, degrees clockwise from north. */
  bearingDeg: number;
  /** The crash report's own height above sea level, metres, when it carries one. */
  altitudeAsl: number | null;
}

/**
 * The crash site of the vessel being watched, or null while nothing says it crashed.
 *
 * It is the crash report of this vessel, and only while the flight readings have stopped being current: a vessel that is still reporting live is flying, whatever an earlier crash of the same craft left on record (a revert flies it again under the same id).
 */
export function crashImpactOf(inputs: {
  crash: Pick<
    TopicPayload<"crash.lastCrash">,
    "vesselId" | "latitude" | "longitude" | "altitude"
  > | null;
  vesselId: string | null | undefined;
  flightIsCurrent: boolean;
  from: { latitude: number; longitude: number } | null;
  bodyRadius: number | null | undefined;
}): CrashImpact | null {
  const { crash, from, bodyRadius } = inputs;
  if (crash == null || from == null || bodyRadius == null) return null;
  if (inputs.flightIsCurrent || inputs.vesselId == null) return null;
  if (crash.vesselId !== inputs.vesselId) return null;
  if (crash.latitude == null || crash.longitude == null) return null;
  const way = greatCircle(
    from.latitude,
    from.longitude,
    crash.latitude.magnitude,
    crash.longitude.magnitude,
    bodyRadius,
  );
  if (!Number.isFinite(way.distanceMeters)) return null;
  const asl = crash.altitude?.magnitude;
  return {
    distanceMeters: way.distanceMeters,
    bearingDeg: way.bearingDeg,
    altitudeAsl: asl != null && Number.isFinite(asl) ? asl : null,
  };
}

/** How far the crash site lies along a line on `trackBearingDeg` from the last reading, metres: negative when it is behind it. */
export function alongTrack(impact: CrashImpact, trackBearingDeg: number) {
  return (
    impact.distanceMeters *
    Math.cos(((impact.bearingDeg - trackBearingDeg) * Math.PI) / 180)
  );
}
