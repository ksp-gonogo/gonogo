import { useTelemetry } from "@ksp-gonogo/core";
import { useStream, useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  type Reading,
  stillTrue,
  TargetKind,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { rosterDistance } from "../shared/rosterDistance";

/** What the in-flight panel shows, for the vessel currently flying. */
export function useFlightState() {
  // The craft's name changes nowhere but the editor, so the last one received still names the vessel flying.
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const vesselName = identity?.name;
  // Off `vessel.flight`'s own field reading, which stays live on rails.
  const altitudeReading: Reading<Value<"m">> =
    useTelemetry("vessel.flight").altitudeAsl;
  // Not in the SDK's typed Topic tail, so read through `useStream`.
  const crashHasRecent = stillTrue(
    useStream<boolean>("crash.hasRecent"),
    undefined,
  );
  const lastCrash = stillTrue(useTelemetry("crash.lastCrash"), undefined);
  // Stays an instant: its only use is the ordering against a crash snapshot's capture ut.
  const viewUt = useViewUt();
  // Elapsed mission time is the view clock measured from liftoff, absent until the clamps release: `launchUt` is null until then.
  const missionTime =
    identity?.launchUt == null || viewUt === undefined
      ? undefined
      : (magnitudeOf(viewUt.minus(identity.launchUt)) ?? undefined);
  /*
   * `target.available` already excludes the active vessel; only Vessel-kind
   * entries are switch targets. The roster is a fact, so the last one stands.
   */
  const rosterReading = useTelemetry("target.available");
  const targetAvailable = stillTrue(rosterReading, undefined);
  const distanceOf = useMemo(
    () => rosterDistance(rosterReading),
    [rosterReading],
  );
  const availableVessels = targetAvailable?.entries?.filter(
    (e) => e.kind === TargetKind.Vessel,
  );

  /*
   * The crash is the active vessel's own, falling back to the session-wide
   * flag before the snapshot arrives. A snapshot dated after the current UT
   * belongs to a reverted timeline.
   */
  const activeVesselCrashed = (): boolean => {
    if (crashHasRecent !== true) return false;
    if (lastCrash == null) return true;
    const reverted =
      lastCrash.ut != null &&
      viewUt !== undefined &&
      lastCrash.ut.greaterThan(viewUt);
    if (reverted) return false;
    return (
      typeof lastCrash.vesselName === "string" &&
      lastCrash.vesselName.length > 0 &&
      lastCrash.vesselName === vesselName
    );
  };

  return {
    vesselName,
    missionTime: missionTime ?? null,
    // The reading itself, so the figure carries its own mark: held keeps the square, a model's figure the triangle.
    altitude: altitudeReading,
    crashInProgress: activeVesselCrashed(),
    availableVessels,
    distanceOf,
  };
}
