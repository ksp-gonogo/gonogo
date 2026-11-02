import { defineTopicManifest } from "@ksp-gonogo/core";
import {
  useViewClockOptional,
  useViewUt,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import {
  DockingPortState,
  deriveReading,
  type Reading,
  stillTrue,
  TargetKind,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useReducer } from "react";
import {
  bare,
  carryForward,
  closingRateReading,
  closingSpeed,
  deriveDockAngles,
  rangeReading,
  vecMagnitude,
} from "../shared/dockAngles";

// Side-effect import: registers the `vessel.target` reckoner (stubbed, so it declines) and its processor.

export const rendezvousTopics = defineTopicManifest({
  channels: ["vessel.target", "vessel.dock"],
  optionalChannels: ["vessel.orbit", "trackingStation.bodies"],
});

/**
 * `vessel.target` is a Reading, so a dropped link can never render "No target
 * set". `vessel.dock` splits per field: the pairing is a fact, while the
 * geometry (reticle, alignment, closing rate) is read as "fly this, now" and
 * stops being drawn once it is held. Its `absent` and `pending` both
 * mean no HUD.
 */
export function useRendezvousReading() {
  const targetReading = rendezvousTopics.useTelemetry("vessel.target");
  const dockReading = rendezvousTopics.useTelemetry("vessel.dock");
  // `vessel.dock` is reckonable: the modelled separation overlays the observation, while relative velocity and `forwardDot` do not move.
  // The observation first: `reckoning.status` narrows the reckoning, not the arm carrying it.
  const dockObserved =
    dockReading.state === "observed" || dockReading.state === "held"
      ? dockReading.value
      : undefined;
  // A current reading draws its observation; a model reaching past the received edge never replaces it.
  const currentDock = () => {
    const carried =
      dockReading.reckoning.status === "available"
        ? dockReading.reckoning
        : undefined;
    if (
      dockReading.state === "observed" &&
      (carried === undefined || carried.beyondReceived)
    )
      return dockReading.value;
    if (dockObserved && carried) return { ...dockObserved, ...carried.value };
    return undefined;
  };
  const dock = currentDock();
  const dockPairing = stillTrue(withoutReckoning(dockReading), undefined);
  const target = stillTrue(withoutReckoning(targetReading), undefined);

  const tarName = target?.name;
  const tarKind = target?.kind;
  // Closest approach is mod-side, off the elected propagation provider: counted from the received edge, and from the target model's instant where one reaches past it.
  const receivedUt = useViewUt();
  const timeToClosestApproach = deriveReading(
    targetReading,
    (t) =>
      t.closestApproach?.time.isFinite() === true && receivedUt !== undefined
        ? t.closestApproach.time.minus(receivedUt)
        : undefined,
    (t, atUt) =>
      t.closestApproach?.time.isFinite() === true
        ? t.closestApproach.time.minus(atUt)
        : undefined,
  );

  // The miss distance at that closest approach, read the same way.
  const closestApproachDistance: Reading<Value<"m">> = deriveReading(
    targetReading,
    (t) => t.closestApproach?.distance ?? undefined,
    (t) => t.closestApproach?.distance ?? undefined,
  );

  const tarRelPos = target?.relativePosition && bare(target.relativePosition);
  const tarRelVelVec =
    target?.relativeVelocity && bare(target.relativeVelocity);
  // Undefined when there is no docking scenario OR the geometry is held; `alignmentWithheld` tells those apart.
  const dockRelVelVec = dock?.relativeVelocity && bare(dock.relativeVelocity);
  // The position arrives about once a second and the view clock never runs past the newest sample, so between samples it is carried forward on the velocity by the sample's age (the craft's present less the signal delay, past the sample's instant), up to a limit, so the reticle and the camera marks move steadily.
  const dockSampleBare = dock?.relativePosition && bare(dock.relativePosition);
  // Only the observation is carried: where the delay model has already reckoned the position on, it is not moved twice.
  const dockSampleUt =
    dockReading.state === "observed" && dock === dockReading.value
      ? dockReading.atUt.magnitude
      : undefined;
  const viewClock = useViewClockOptional();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const carrying = dockSampleUt !== undefined && dockRelVelVec !== undefined;
  // The view time stands still between samples, so nothing else draws a frame in that gap: while a position is being carried, each frame of the clock does.
  useEffect(() => {
    if (!carrying || viewClock === undefined) return;
    return viewClock.onFrame(() => redraw());
  }, [carrying, viewClock]);
  const dockSampleAge =
    dockSampleUt !== undefined && viewClock !== undefined
      ? viewClock.utNowEstimate() - viewClock.delaySeconds() - dockSampleUt
      : undefined;
  const dockRelPos =
    dockSampleBare && dockRelVelVec && dockSampleAge !== undefined
      ? carryForward(dockSampleBare, dockRelVelVec, dockSampleAge)
      : dockSampleBare;
  const dockDistanceStream = dock?.distance?.magnitude;
  const dockForwardDot = dock?.forwardDot?.magnitude;
  // Either port reading joined counts: the craft's own port and the target's port move together at a dock, and the target's can be the only one delivered while the own side is between states. Capture is the last state `vessel.dock` delivers before the target clears at the dock, so a captured port counts as joined along with pre-attached and docked.
  const isJoined = (state: DockingPortState | null | undefined) =>
    state === DockingPortState.Acquire ||
    state === DockingPortState.PreAttached ||
    state === DockingPortState.Docked;
  const dockJoined =
    isJoined(dock?.ownPortState) || isJoined(dock?.targetPortState);
  // Ids are facts about the pairing: they stay while the geometry is held.
  const vesselPersistentId = dockPairing?.targetVesselPersistentId;
  const portPersistentId = dockPairing?.targetPortPersistentId;
  const dockTargetPort =
    typeof vesselPersistentId === "number" &&
    typeof portPersistentId === "number"
      ? { vesselPersistentId, portPersistentId }
      : undefined;

  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const relVel =
    tarRelPos && tarRelVelVec
      ? closingSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  // The plain numbers drive the mode machine and guards; these are what the readouts draw, so a held range is marked.
  const rangeR = rangeReading(targetReading.relativePosition);
  const closingRateR = closingRateReading(
    targetReading.relativePosition,
    targetReading.relativeVelocity,
  );
  const derivedDockAngles = dockRelPos
    ? deriveDockAngles(dockRelPos)
    : undefined;
  const dockAx = derivedDockAngles?.ax;
  const dockAy = derivedDockAngles?.ay;
  // Docking-port roll is not on the wire, so the third axis renders NULL_DISPLAY.
  const dockAz: number | undefined = undefined;
  const dockX = dockRelPos?.x;
  const dockY = dockRelPos?.y;
  const derivedDockClosing =
    dockRelPos && dockRelVelVec
      ? closingSpeed(dockRelPos, dockRelVelVec)
      : undefined;
  // The docking readout prefers the port-to-port closing rate.
  const dockingClosing = derivedDockClosing ?? relVel;
  // The range moves on by as much as the carried position's length did, so it keeps pace with the reticle.
  const carriedBy =
    dockRelPos !== undefined &&
    dockSampleBare !== undefined &&
    dockRelPos !== dockSampleBare
      ? vecMagnitude(dockRelPos) - vecMagnitude(dockSampleBare)
      : 0;
  const dockingDistance =
    dockDistanceStream !== undefined
      ? dockDistanceStream + carriedBy
      : tarDistance;
  // What dates the docking HUD's figures for an augment drawn over them: the dock reading, unless the distance fell back to a held target range.
  const dockingFiguresReading =
    dockDistanceStream === undefined && targetReading.state === "held"
      ? withoutReckoning(targetReading)
      : dockReading;

  // A docking port is the target: the docking channel is expected to report it once close.
  const portTargeted = tarKind === TargetKind.Part;

  // A real non-body target, read off the ORDINAL: drives the APPROACH view.
  const dockable =
    tarKind !== undefined &&
    tarKind !== TargetKind.Body &&
    tarName !== undefined;

  // The HUD needs `vessel.dock`, published only for a port target with a free port on our side; distance alone would draw a dead reticle.
  const dockingAvailable = dockRelPos !== undefined;

  /*
   * The pairing is still selected but its geometry is held, so the
   * reticle is WITHHELD, which looks identical to a target that stopped being a
   * port. The reckoning arm is excluded: a modelled reticle is drawn under its
   * own caption, and never with neither.
   */
  const alignmentWithheld =
    dockReading.state === "held" &&
    dockReading.reckoning.status !== "available" &&
    dockPairing?.relativePosition !== undefined;
  // The separation is being carried forward from a held observation, so the HUD says its geometry is modelled.
  const modelledAlignment =
    dockReading.reckoning.status === "available" && dockReading.state === "held"
      ? dockReading.reckoning.basis
      : undefined;

  // Out of contact the headline is an observation, not a reading of now.
  const outOfContact = targetReading.state === "held";
  // Pulled here so a modelled number reaches the screen only through code that says it is modelling.
  const reckoned =
    targetReading.reckoning.status === "available"
      ? targetReading.reckoning
      : undefined;
  // Derived exactly as the observed distance is; a model with no relative position renders nothing, not a zero.
  const reckonedRelPos =
    reckoned?.value.relativePosition && bare(reckoned.value.relativePosition);
  const reckonedDistance = reckonedRelPos
    ? vecMagnitude(reckonedRelPos)
    : undefined;

  return {
    targetState: targetReading.state,
    tarName,
    dockable,
    timeToClosestApproach,
    closestApproachDistance,
    tarDistance,
    relVel,
    rangeR,
    closingRateR,
    dockAx,
    dockAy,
    dockAz,
    dockX,
    dockY,
    dockingClosing,
    dockingDistance,
    dockingFiguresReading,
    dockForwardDot,
    dockTargetPort,
    dockJoined,
    dockingAvailable,
    portTargeted,
    alignmentWithheld,
    modelledAlignment,
    outOfContact,
    reckoned,
    reckonedDistance,
  };
}

export type RendezvousReading = ReturnType<typeof useRendezvousReading>;
