import { defineTopicManifest } from "@ksp-gonogo/core";
import {
  observedAt,
  useViewUt,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, TargetKind, value } from "@ksp-gonogo/sitrep-sdk";
import {
  bare,
  closingRateReading,
  deriveDockAngles,
  radialSpeed,
  rangeReading,
  vecMagnitude,
} from "../shared/dockAngles";
import { magnitudeOf } from "../shared/magnitude";

// Side-effect import: registers the `vessel.target` reckoner (stubbed, so it declines) and its processor.

export const targetingTopics = defineTopicManifest({
  channels: ["vessel.target", "vessel.dock"],
});

/**
 * `vessel.target` is a Reading, so a dropped link can never render "No target
 * set". `vessel.dock` splits per FIELD: the pairing is a fact, while the
 * geometry (reticle, alignment, closing rate) is read as "fly this, now" and
 * stops being drawn once it is not current. Its `absent` and `pending` both
 * mean no HUD.
 */
export function useTargetingReading() {
  const targetReading = targetingTopics.useTelemetry("vessel.target");
  const dockReading = targetingTopics.useTelemetry("vessel.dock");
  // `vessel.dock` is reckonable: the modelled separation overlays the observation, while relative velocity and `forwardDot` do not move.
  // The observation first: `reckoning.status` narrows the reckoning, not the arm carrying it.
  const dockObserved =
    dockReading.state === "observed" || dockReading.state === "stale"
      ? dockReading.value
      : undefined;
  const dock =
    dockObserved && dockReading.reckoning.status === "available"
      ? { ...dockObserved, ...dockReading.reckoning.value }
      : dockReading.state === "observed"
        ? dockReading.value
        : undefined;
  const dockPairing = stillTrue(withoutReckoning(dockReading), undefined);
  const target = stillTrue(withoutReckoning(targetReading), undefined);

  const tarName = target?.name;
  const tarKind = target?.kind;
  // Closest approach is mod-side, off the elected propagation provider; the view-UT is "now".
  const closestApproachUT = magnitudeOf(target?.closestApproach?.time);
  // Unwrapped: the guards downstream use `typeof`/`Number.isFinite`, which answer NO for a wrapped value.
  const universalTime = useViewUt()?.magnitude;

  const tarRelPos = target?.relativePosition && bare(target.relativePosition);
  const tarRelVelVec =
    target?.relativeVelocity && bare(target.relativeVelocity);
  // Undefined when there is no docking scenario OR the geometry is not current; `alignmentWithheld` tells those apart.
  const dockRelPos = dock?.relativePosition && bare(dock.relativePosition);
  const dockRelVelVec = dock?.relativeVelocity && bare(dock.relativeVelocity);
  const dockDistanceStream = dock?.distance?.magnitude;
  const dockForwardDot = dock?.forwardDot?.magnitude;

  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const relVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
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
  const derivedDockRelVel =
    dockRelPos && dockRelVelVec
      ? radialSpeed(dockRelPos, dockRelVelVec)
      : undefined;
  // The docking HUD's Δv row prefers the port-to-port closing rate.
  const dockingRelVel = derivedDockRelVel ?? relVel;
  const dockingDistance = dockDistanceStream ?? tarDistance;

  // A real non-body target, read off the ORDINAL: drives the APPROACH view.
  const dockable =
    tarKind !== undefined &&
    tarKind !== TargetKind.Body &&
    tarName !== undefined;

  // The HUD needs `vessel.dock`, published only for a port target with a free port on our side; distance alone would draw a dead reticle.
  const dockingAvailable = dockRelPos !== undefined;

  /*
   * The pairing is still selected but its geometry is no longer current, so the
   * reticle is WITHHELD, which looks identical to a target that stopped being a
   * port. The reckoning arm is excluded: a modelled reticle is drawn under its
   * own caption, and never with neither.
   */
  const alignmentWithheld =
    dockReading.state === "stale" &&
    dockReading.reckoning.status !== "available" &&
    dockPairing?.relativePosition !== undefined;
  // The separation is being carried forward, so the HUD says its geometry is modelled.
  const modelledAlignment =
    dockReading.reckoning.status === "available" &&
    dockReading.state === "stale"
      ? dockReading.reckoning.basis
      : undefined;
  // Ages are game-time `value("s", ...)` off the frame's view-UT, clamped at zero since samples arrive out of order.
  const dockObservedUt = observedAt(dockReading);
  const dockAge =
    universalTime !== undefined && dockObservedUt
      ? value("ut", universalTime).minus(dockObservedUt).max(0)
      : undefined;

  // Out of contact the headline is an observation, not a reading of now.
  const outOfContact = targetReading.state === "stale";
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
    closestApproachUT,
    universalTime,
    tarDistance,
    relVel,
    rangeR,
    closingRateR,
    dockAx,
    dockAy,
    dockAz,
    dockX,
    dockY,
    dockingRelVel,
    dockingDistance,
    dockForwardDot,
    dockingAvailable,
    alignmentWithheld,
    modelledAlignment,
    dockAge,
    outOfContact,
    reckoned,
    reckonedDistance,
  };
}

export type TargetingReading = ReturnType<typeof useTargetingReading>;
