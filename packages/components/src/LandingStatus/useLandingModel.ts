import { useTelemetry } from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  type ReadingState,
  type ReckonableReading,
  type TopicReading,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  type Reading,
  readingOf,
  type TopicPayload,
  type Value,
  type Vec3Of,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useState } from "react";
import { bare, vecMagnitude } from "../shared/dockAngles";
import { bodyAtIndex } from "../shared/streamBody";
import { useBodyName } from "../shared/useBodyName";
import { deriveBoard, type LandingBoard } from "./board";
import { deriveActiveBurnParams } from "./burnParams";
import type { FlightReading } from "./CarriedAltitude";
import {
  type DelayClocks,
  deriveDelayClocks,
  readOneWaySeconds,
} from "./clocks";
import { greatCircle } from "./geo";
import { isGroundedSituation } from "./grounded";
import { deriveHazardVerdict, type HazardResult } from "./hazardVerdict";
import { type LandingSolution, solveSuicideBurn } from "./solveLanding";

const DESCENT_HISTORY_MAX = 60;

/** The descent as the widget reads it: every topic, the burn solve on them, the delay clocks, and the predicted site. */
export interface LandingModel {
  flight: TopicPayload<"vessel.flight"> | undefined;
  flightReading: FlightReading;
  landing: TopicPayload<"vessel.landing"> | undefined;
  landingReading: ReturnType<typeof useTelemetry<"vessel.landing">>;
  solution: LandingSolution;
  landed: boolean;
  /** Even the optimal burn arrives above a survivable speed. */
  noLandingVector: boolean;
  availableDv: Value<"m/s"> | undefined;
  requiredDv: number | null;
  /** Null, never false, when either side of the comparison is missing. */
  affordable: boolean | null;
  board: LandingBoard;
  clocks: DelayClocks;
  live: boolean;
  /** No input the burn solve rests on is held. */
  mayInstruct: boolean;
  /** The held inputs the board is describing from. */
  describedInputs: string[];
  bodyName: string | null | undefined;
  atmospheric: boolean;
  targetRange: number | undefined;
  /** The burn datum: the lowest point above terrain, else the centre of mass. */
  heightFromTerrain: Value<"m"> | null | undefined;
  usingComDatum: boolean;
  aglReading: Reading<Value<"m">>;
  siteDrift: ReturnType<typeof greatCircle> | null;
  hazardVerdict: HazardResult;
  descentHistory: number[];
}

export function useLandingModel(): LandingModel {
  // Range to the target, measured with the same pair `Targeting` uses so the two widgets agree.
  const targetReading = useStream<{ relativePosition?: Vec3Of<"m"> }>(
    "vessel.target",
  );
  const targetStream =
    targetReading.state === "observed" || targetReading.state === "stale"
      ? targetReading.value
      : undefined;
  const targetRange = targetStream?.relativePosition
    ? vecMagnitude(bare(targetStream.relativePosition))
    : undefined;
  const identityReading = useTelemetry("vessel.identity");
  const bodiesReading = useTelemetry("system.bodies");
  const flightReading = useTelemetry("vessel.flight");
  const surfaceReading = useTelemetry("vessel.surface");
  const propulsionReading = useTelemetry("vessel.propulsion");
  const orbitReading = useTelemetry("vessel.orbit");
  const landingReading = useTelemetry("vessel.landing");

  /**
   * Describe from the best value available; instruct only from a current one.
   *
   * - a DESCRIPTION (altitude, velocity, delta-v) renders from a modelled or last-known value, labelled as such
   * - an INSTRUCTION (the burn instant, the ignition countdown) never renders from a reckoned state: the operator acts on it at a named moment
   *
   * Losing contact mid-descent is the expected case, so the board is never blanked.
   */
  const describe = <T>(r: TopicReading<T>): T | undefined =>
    r.reckoning.status === "available"
      ? r.reckoning.value
      : r.state === "observed" || r.state === "stale"
        ? r.value
        : undefined;

  /** The same policy for a contract-reckonable topic, overlaying the fields the model moves onto the observation; `reckoned.value` alone lacks every number the board descends on. */
  const describeReckonable = <T, K extends keyof T>(
    r: ReckonableReading<T, K>,
  ): T | undefined => {
    // `reckoning.status` narrows the reckoning, not the arm carrying it.
    if (r.state !== "observed" && r.state !== "stale") return undefined;
    return r.reckoning.status === "available"
      ? { ...r.value, ...r.reckoning.value }
      : r.value;
  };

  // A situation does not decay the way a velocity does, so `describe` is the right read.
  const identity = describe(identityReading);
  const bodyName = useBodyName(identity?.parentBodyIndex);
  const flight = describeReckonable(flightReading);
  const surface = describe(surfaceReading);
  const propulsion = describe(propulsionReading);
  // The conic moves the phase only, so this overlays like `vessel.flight`.
  const orbit = describeReckonable(orbitReading);
  const landing = describe(landingReading);
  // Resolved by index, not by name against the stock table, so a planet pack's renamed bodies still resolve.
  const body = bodyAtIndex(describe(bodiesReading), identity?.parentBodyIndex);
  const atmospheric = body?.hasAtmosphere ?? false;
  // A dated budget is still the best figure, and every readout from it is a figure rather than a control.
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const commsDelayReading = useTelemetry("comms.delay");
  // `oneWaySeconds` is carriable, so the model's projection is overlaid rather than taken whole.
  const commsDelay = describeReckonable(commsDelayReading);

  // Whether the board is describing rather than reporting, and which readings put it there; it drives a caption, never a blank.
  const isDated = (r: { state: ReadingState }): boolean => r.state === "stale";
  const datedInputs = [
    isDated(flightReading) ? "flight" : null,
    isDated(surfaceReading) ? "surface" : null,
    isDated(propulsionReading) ? "propulsion" : null,
    isDated(orbitReading) ? "orbit" : null,
    isDated(landingReading) ? "landing" : null,
  ].filter((name): name is string => name !== null);
  /**
   * The gate on the INSTRUCTION half: no input the burn solve rests on may be dated.
   * A never-arrived input does not refuse, since `solveSuicideBurn` already answers "not-descending" when it lacks data.
   */
  const mayInstruct = datedInputs.length === 0;
  // Target range is a description the burn does not rest on, so a held one joins the caption without refusing the instruction.
  const describedInputs = isDated(targetReading)
    ? [...datedInputs, "target"]
    : datedInputs;

  const { exhaustVelocity, burnoutMass } = deriveActiveBurnParams(
    budget?.activeStage,
    propulsion,
    budget?.totalActual?.magnitude,
    budget?.totalVac?.magnitude,
  );

  // The burn datum is the vessel's lowest point above terrain, falling back to CoM radar altitude with a note when `vessel.surface` is null.
  const surfaceHeight = surface?.heightFromTerrain;
  const heightFromTerrain = surfaceHeight ?? flight?.altitudeTerrain;
  const usingComDatum = surfaceHeight == null && heightFromTerrain != null;
  const aglReading =
    surfaceHeight != null
      ? readingOf(surfaceReading, (s) => s.heightFromTerrain ?? undefined)
      : readingOf(flightReading, (f) => f.altitudeTerrain);

  const solution = solveSuicideBurn({
    heightFromTerrain: heightFromTerrain?.magnitude,
    altitudeAsl: flight?.altitudeAsl?.magnitude,
    verticalSpeed: flight?.verticalSpeed?.magnitude,
    surfaceSpeed: flight?.surfaceSpeed?.magnitude,
    mu: orbit?.mu?.magnitude,
    bodyRadius: body?.radius,
    availableThrust: propulsion?.availableThrust?.magnitude,
    totalMass: propulsion?.totalMass?.magnitude,
    exhaustVelocity,
    burnoutMass,
  });

  // Gated on the situation, not the impact figure, since a grounded vessel can report a residual altitude; `landedAt` is the direct signal.
  const landed =
    surface?.landedAt != null || isGroundedSituation(identity?.situation);

  const oneWaySeconds = readOneWaySeconds(commsDelay);
  const clocks = deriveDelayClocks({
    oneWaySeconds,
    suicideBurnCountdown: solution.suicideBurnCountdown,
    timeToImpact: solution.timeToImpact,
    landed,
  });

  // A vacuum solution exists but even the optimal burn hits at `bestSpeedAtImpact`, which is not the same as a nominal committed burn (0 means it fits).
  const noLandingVector =
    !landed &&
    solution.state === "vacuum-solved" &&
    solution.bestSpeedAtImpact != null &&
    solution.bestSpeedAtImpact > 0.5;

  const availableDv = budget?.totalActual ?? budget?.totalVac ?? undefined;
  const requiredDv = solution.burnDeltaV;
  const affordable =
    requiredDv != null && availableDv != null
      ? availableDv.greaterThanOrEqual(requiredDv)
      : null;

  const atmosphereAware = landing?.terminalVelocity != null;
  const board = deriveBoard({
    solutionState: solution.state,
    atmospheric,
    atmosphereAware,
  });

  // A bounded vertical-speed history, so a developing over-speed reads as a trend.
  const [descentHistory, setDescentHistory] = useState<number[]>([]);
  const currentVs = flight?.verticalSpeed?.magnitude;
  useEffect(() => {
    if (currentVs == null || !Number.isFinite(currentVs)) return;
    setDescentHistory((h) => {
      const next = [...h, currentVs];
      return next.length > DESCENT_HISTORY_MAX
        ? next.slice(next.length - DESCENT_HISTORY_MAX)
        : next;
    });
  }, [currentVs]);

  // `no-path` is not live: with no comms telemetry at all the hero must not claim the loop is closed.
  const live = clocks.regime === "live";
  /*
   * Every axis grades on its point estimate, with no band, because none exists: only `altitudeAsl` is banded on `vessel.flight`.
   * Vertical speed is not a reckonable field, and the lateral rate and slope come from the solve and `vessel.landing`.
   */
  const hazardVerdict = deriveHazardVerdict({
    slopeDeg: landing?.predictedSlopeAngle?.magnitude,
    roughnessSigma: landing?.predictedRoughness?.magnitude,
    verticalSpeed: solution.verticalSpeed,
    lateralSpeed: solution.horizontalSpeed,
    biome: landing?.predictedBiome,
  });
  // Sub-vessel to predicted site: the bearing slices the cross-section, the distance is the downrange readout.
  const siteDrift =
    flight?.latitude != null &&
    flight?.longitude != null &&
    landing?.predictedLatitude != null &&
    landing?.predictedLongitude != null &&
    body?.radius != null
      ? greatCircle(
          flight.latitude.magnitude,
          flight.longitude.magnitude,
          landing.predictedLatitude.magnitude,
          landing.predictedLongitude.magnitude,
          body.radius,
        )
      : null;

  return {
    flight,
    flightReading,
    landing,
    landingReading,
    solution,
    landed,
    noLandingVector,
    availableDv,
    requiredDv,
    affordable,
    board,
    clocks,
    live,
    mayInstruct,
    describedInputs,
    bodyName,
    atmospheric,
    targetRange,
    heightFromTerrain,
    usingComDatum,
    aglReading,
    siteDrift,
    hazardVerdict,
    descentHistory,
  };
}
