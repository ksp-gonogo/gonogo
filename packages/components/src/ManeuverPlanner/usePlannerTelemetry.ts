import type { CurrentOrbit } from "@ksp-gonogo/core";
import { useOrbitSolve, useTelemetry } from "@ksp-gonogo/core";
import {
  type BodyRadiusTable,
  bodyRadiusOf,
  DELTA_V_BUDGET,
  type OrbitTrajectory,
  type ReckonableReading,
  solveOrbit,
  useOrbitTrajectory,
  useProcessor,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, type Value } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { bodyFromStream } from "../shared/streamBody";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { buildCurrentOrbit, computeMu } from "./planning";

/**
 * A reckonable reading's value, and whether it needs an age label. The model
 * moves only its named fields, so they are overlaid on the observation:
 * `reckoned.value` alone would be a target with no name and no orbit.
 */
function dateableReckonable<Payload, ReckonableKey extends keyof Payload>(
  reading: ReckonableReading<Payload, ReckonableKey>,
): {
  value: Payload | undefined;
  needsDating: boolean;
} {
  // The state is asked first: `reckoning.status` narrows the reckoning, not the arm carrying it.
  if (
    (reading.state === "observed" || reading.state === "held") &&
    reading.reckoning.status === "available"
  )
    return {
      value: { ...reading.value, ...reading.reckoning.value },
      needsDating: false,
    };
  if (reading.state === "observed")
    return { value: reading.value, needsDating: false };
  if (reading.state === "held")
    return { value: reading.value, needsDating: true };
  return { value: undefined, needsDating: false };
}

/** Every telemetry figure the planner plans from, each as the number it is planned with. */
export function usePlannerTelemetry() {
  // A plan is reviewed before it is committed, so elements a few seconds old are dated, never withheld.
  const orbitReading = useTelemetry("vessel.orbit");
  const targetReading = useTelemetry("vessel.target");
  const { value: orbit, needsDating: orbitNeedsDating } =
    dateableReckonable(orbitReading);
  const { value: target, needsDating: targetNeedsDating } =
    dateableReckonable(targetReading);
  const elementsNeedDating = orbitNeedsDating || targetNeedsDating;
  // Latched rather than `currentThrust > 0` and kept when held, so it survives a dropped frame; undefined is not "engines off".
  const propulsion = stillTrue(useTelemetry("vessel.propulsion"), undefined);
  const thrustLatch = propulsion
    ? {
        thrusting: propulsion.thrustStartedUt?.isFinite() === true,
        lastThrustEndUt: magnitudeOf(propulsion.lastThrustEndUt),
      }
    : undefined;
  // The current orbit's curve is the propagation seam's answer, never a diagram's own choice.
  const currentTrajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const sma = magnitudeOf(orbit?.sma) ?? undefined;
  const ecc = magnitudeOf(orbit?.ecc) ?? undefined;
  // Answers nothing wherever a conic through these elements would be wrong, which is what withholds the plan.
  const solve = useOrbitSolve();
  const ApR = solve?.apoapsisRadius ?? undefined;
  const PeR = solve?.periapsisRadius ?? undefined;
  const timeToAp = solve?.timeToAp ?? undefined;
  const timeToPe = solve?.timeToPe ?? undefined;
  const argPe = magnitudeOf(orbit?.argPe) ?? undefined;
  const trueAnomaly = solve?.trueAnomaly ?? undefined;
  const currentUT: Value<"ut"> | undefined = useViewUt();
  // The burn windows and the conformance regime place node instants, which arrive as plain UT seconds, so they read the view instant the same way.
  const nowUtSeconds = currentUT?.magnitude;
  const orbitalSpeedReading = useTelemetry("vessel.flight").orbitalSpeed;
  // computeMu wants a number true of the craft now: modelled where on offer, else observed.
  const speedNow = () => {
    if (orbitalSpeedReading.reckoning.status === "available") {
      return orbitalSpeedReading.reckoning.modelled;
    }
    if (orbitalSpeedReading.state === "observed")
      return orbitalSpeedReading.value;
    return undefined;
  };
  const orbitalSpeed = magnitudeOf(speedNow()) ?? undefined;
  const radius = solve?.orbitalRadius ?? undefined;
  const parentBodyIndex = useParentBodyIndex();
  const bodiesReading = useStream<BodyRadiusTable>("system.bodies");
  // The roster does not decay, and a tombstone is the one null it answers.
  const bodies = stillTrue(bodiesReading, null);
  const refBody = useBodyName(orbit?.referenceBodyIndex);
  const bodyName = useBodyName(parentBodyIndex);
  const parentBodyRadius = bodyRadiusOf(bodies, parentBodyIndex);
  const referenceBodyRadius = bodyRadiusOf(bodies, orbit?.referenceBodyIndex);
  const inclination = magnitudeOf(orbit?.inc) ?? undefined;
  const targetName = target?.name;
  const targetInclinationLive = magnitudeOf(target?.orbit?.inc) ?? undefined;
  const targetLanLive = magnitudeOf(target?.orbit?.lan) ?? undefined;
  const targetSma = target?.orbit?.sma?.magnitude;
  const targetArgPe = target?.orbit?.argPe?.magnitude;
  // The target's altitude needs the target's own reference body, not the craft's.
  const targetSolved =
    target?.orbit == null || currentUT === undefined
      ? undefined
      : solveOrbit(
          target.orbit,
          currentUT,
          bodyRadiusOf(bodies, target.orbit.referenceBodyIndex),
        );
  const targetPeA = targetSolved?.periapsisAlt ?? undefined;
  const targetTrueAnomaly = targetSolved?.trueAnomaly ?? undefined;
  const targetPeriod = targetSolved?.period ?? undefined;
  const lan = orbit?.lan?.magnitude;

  const period = solve?.period ?? undefined;
  /*
   * The game's own vessel ΔV total, never a sum of the stage rows, which come
   * from a different stage list. Kept when held, since a budget vanishing in a
   * blackout would re-enable the commit for a craft known to be short.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const availableDeltaV = magnitudeOf(
    budgetReading?.state === "observed" || budgetReading?.state === "held"
      ? budgetReading.value?.totalVac
      : undefined,
  );

  // Radius by index off the wire; only the body colour comes from the static table, since nothing reports one.
  const body = useMemo(
    () =>
      bodyFromStream({
        name: bodyName ?? refBody,
        radius: parentBodyRadius ?? referenceBodyRadius,
      }),
    [bodyName, refBody, parentBodyRadius, referenceBodyRadius],
  );

  const mu = useMemo(
    () => computeMu(orbitalSpeed, radius, sma, period),
    [orbitalSpeed, radius, sma, period],
  );

  const currentOrbit: CurrentOrbit | null = buildCurrentOrbit({
    sma,
    ecc,
    ApR,
    PeR,
    timeToAp,
    timeToPe,
  });

  return {
    orbitObserved: orbitReading.state === "observed",
    elementsNeedDating,
    thrustLatch,
    currentTrajectory,
    sma,
    ecc,
    ApR,
    PeR,
    timeToAp,
    timeToPe,
    argPe,
    trueAnomaly,
    currentUT,
    nowUtSeconds,
    refBody,
    inclination,
    targetName,
    targetInclinationLive,
    targetLanLive,
    targetSma,
    targetArgPe,
    targetPeA,
    targetTrueAnomaly,
    targetPeriod,
    lan,
    period,
    availableDeltaV,
    body,
    mu,
    currentOrbit,
  };
}

export type PlannerTelemetry = ReturnType<typeof usePlannerTelemetry>;
