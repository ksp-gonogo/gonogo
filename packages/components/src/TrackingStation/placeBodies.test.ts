import {
  ANALYTIC_BODY_HORIZON,
  type BodyPose,
  type BodyPoseCurrency,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { placeBodies } from "./diagramGeometry";
import { INERTIAL_PLACEMENT } from "./projection";
import type { CelestialBody } from "./useCelestialBodies";

function body(
  index: number,
  elements: Partial<
    Pick<
      CelestialBody,
      | "semiMajorAxis"
      | "eccentricity"
      | "inclination"
      | "lan"
      | "argumentOfPeriapsis"
    >
  > = {},
): CelestialBody {
  return {
    index,
    name: `Body ${index}`,
    referenceBody: "Kerbin",
    radius: 200_000,
    soi: null,
    gravParameter: null,
    semiMajorAxis: 12_000_000,
    eccentricity: 0.1,
    inclination: 0,
    lan: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: null,
    epoch: null,
    horizon: ANALYTIC_BODY_HORIZON,
    deterministic: true,
    period: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    initialRotation: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
    figures: {
      radius: null,
      mass: null,
      surfaceGravity: null,
      dayLength: null,
      atmosphereDepth: null,
    },
    ...elements,
  };
}

const place = (children: CelestialBody[]) =>
  placeBodies({
    parent: null,
    children,
    poses: undefined,
    placement: INERTIAL_PLACEMENT,
    plotScale: 1e-5,
  });

/** A body with no pose or no orbit has no place to be drawn, which a zero anomaly or axis would otherwise invent: periapsis, or on top of its parent. */
describe("placeBodies", () => {
  it("draws no body before any pose has arrived, not at periapsis", () => {
    expect(place([body(1), body(2)]).bodies).toEqual([]);
  });

  it("leaves out a body whose orbit lacks an element, however its pose reads", () => {
    expect(place([body(1, { semiMajorAxis: null })]).bodies).toEqual([]);
    expect(place([body(2, { lan: null })]).bodies).toEqual([]);
  });

  it("says which bodies are placed from a held pose, so the mark can say it is old", () => {
    const pose = (index: number, currency: BodyPoseCurrency): BodyPose => ({
      index,
      currency,
      atUt: 100,
      asOfUt: currency === "held" ? 100 : null,
      untilUt: null,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trueAnomaly: 30,
    });
    const placed = placeBodies({
      parent: null,
      children: [body(1), body(2)],
      poses: {
        ut: 200,
        poseByIndex: { 1: pose(1, "held"), 2: pose(2, "exact") },
      },
      placement: INERTIAL_PLACEMENT,
      plotScale: 1e-5,
    }).bodies;

    expect(placed.map((p) => [p.body.index, p.held])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});
