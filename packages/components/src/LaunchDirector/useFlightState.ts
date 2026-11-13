import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  type Reading,
  type SwitchableVessel,
  stillTrue,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { rosterDistanceById } from "../shared/rosterDistance";

/** What the in-flight panel shows, for the vessel currently flying. */
export function useFlightState() {
  // The craft's name changes nowhere but the editor, so the last one received still names the vessel flying.
  const identityReading = useTelemetry("vessel.identity");
  const identity = stillTrue(identityReading, undefined);
  // Confirmed nothing, as when the flown vessel is destroyed: a reading not yet received is "pending" and does not count.
  const noActiveVessel = identityReading.state === "absent";
  // The game's own statement of which craft is flying, so an unlinked craft is named before its identity arrives.
  const activeVessel = stillTrue(useTelemetry("ksp.activeVessel"), undefined);
  const vesselName = identity?.name ?? activeVessel?.name;
  const vesselId = identity?.vesselId;
  // Crew of this vessel who are outside it: recovering the vessel does not bring them home.
  const crewOutside = (
    stillTrue(useTelemetry("eva.crew"), undefined)?.kerbals ?? []
  ).flatMap((member) =>
    member.name && vesselId !== undefined && member.parentVesselId === vesselId
      ? [member.name]
      : [],
  );
  // Off `vessel.flight`'s own field reading, which stays live on rails.
  const altitudeReading: Reading<Value<"m">> =
    useTelemetry("vessel.flight").altitudeAsl;
  const crashHasRecent = stillTrue(
    useTelemetry("crash.hasRecent"),
    undefined,
  )?.recent;
  const lastCrash = stillTrue(useTelemetry("crash.lastCrash"), undefined);
  // Stays an instant: its only use is the ordering against a crash snapshot's capture ut.
  const viewUt = useViewUt();
  // Elapsed mission time is the view clock measured from liftoff, absent until the clamps release: `launchUt` is null until then.
  const missionTime =
    identity?.launchUt == null || viewUt === undefined
      ? undefined
      : (magnitudeOf(viewUt.minus(identity.launchUt)) ?? undefined);
  /*
   * Switching vessel is a scene change that needs no link, so the list comes off
   * the save's own roster of identities. The ranges come off `target.available`,
   * which carries only what the active vessel knows of, so a craft it has no
   * word of is listed with no figure.
   */
  const availableVessels = stillTrue(
    useTelemetry("ksp.switchableVessels"),
    undefined,
  )?.entries;
  const rosterReading = useTelemetry("target.available");
  const distanceById = useMemo(
    () => rosterDistanceById(rosterReading),
    [rosterReading],
  );
  const distanceOf = useCallback(
    (entry: SwitchableVessel) => distanceById(entry.vesselId),
    [distanceById],
  );

  /*
   * The crash is the active vessel's own, falling back to the session-wide
   * flag before the snapshot arrives. A snapshot dated after the current UT
   * belongs to a reverted timeline. Two ids settle it; the name is the
   * fallback only while either id is missing, since a craft flown twice keeps
   * its name across flights.
   */
  const activeVesselCrashed = (): boolean => {
    if (crashHasRecent !== true) return false;
    if (lastCrash == null) return true;
    const reverted =
      lastCrash.ut != null &&
      viewUt !== undefined &&
      lastCrash.ut.greaterThan(viewUt);
    if (reverted) return false;
    if (
      typeof lastCrash.vesselId === "string" &&
      lastCrash.vesselId.length > 0 &&
      typeof vesselId === "string" &&
      vesselId.length > 0
    ) {
      return lastCrash.vesselId === vesselId;
    }
    return (
      typeof lastCrash.vesselName === "string" &&
      lastCrash.vesselName.length > 0 &&
      lastCrash.vesselName === vesselName
    );
  };

  return {
    vesselName,
    noActiveVessel,
    crewOutside,
    missionTime: missionTime ?? null,
    // The reading itself, so the figure carries its own mark: held keeps the square, a model's figure the triangle.
    altitude: altitudeReading,
    crashInProgress: activeVesselCrashed(),
    availableVessels,
    distanceOf,
  };
}
