import { useTelemetry } from "@ksp-gonogo/core";
import { useStream, useViewUt } from "@ksp-gonogo/sitrep-client";
import { stillTrue, TargetKind } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "../shared/magnitude";

/** What the in-flight panel shows and gates on, for the vessel currently flying. */
export function useFlightState() {
  // The craft's name changes nowhere but the editor, so the last one received still names the vessel flying.
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const vesselName = identity?.name;
  // Off `vessel.flight`'s own field reading, which stays live on rails.
  const altitudeReading = useTelemetry("vessel.flight").altitudeAsl;
  const altitudeNow = () => {
    if (altitudeReading.reckoning.status === "available") {
      return altitudeReading.reckoning.modelled;
    }
    if (altitudeReading.state === "observed") return altitudeReading.value;
    return undefined;
  };
  const altitudeMeters = magnitudeOf(altitudeNow());
  /**
   * The revert point is a capability the game grants and withdraws on events,
   * so a held one stands; each control is armed then confirmed anyway.
   */
  const revertAvailability = stillTrue(
    useTelemetry("ksp.revertAvailability"),
    undefined,
  );
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
  const targetAvailable = stillTrue(
    useTelemetry("target.available"),
    undefined,
  );
  const availableVessels = targetAvailable?.entries?.filter(
    (e) => e.kind === TargetKind.Vessel,
  );

  /*
   * Recovery is crash-blocked only when the latest crash is the active
   * vessel's, falling back to the session-wide flag before the snapshot
   * arrives. A snapshot dated after the current UT belongs to a reverted
   * timeline.
   */
  const crashBlocksRecovery = (): boolean => {
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
    altitudeMeters: altitudeMeters ?? null,
    canRevertToLaunch: revertAvailability?.canRevertToLaunch ?? false,
    canRevertToEditor: revertAvailability?.canRevertToEditor ?? false,
    crashBlocked: crashBlocksRecovery(),
    availableVessels,
  };
}
