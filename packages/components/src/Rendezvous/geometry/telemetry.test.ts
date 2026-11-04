import { TrajectoryKind, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  approachOf,
  bodyNumbers,
  elementsOf,
  patchAround,
  patchNumbers,
} from "./telemetry";

const orbit = {
  sma: value("m", 700_000),
  ecc: value("1", 0.001),
  inc: value("°", 3),
  lan: value("°", 40),
  argPe: null,
  meanAnomalyAtEpoch: value("rad", 1.2),
  epoch: value("ut", 500),
  mu: value("m³/s²", 3.5316e12),
};

describe("elementsOf", () => {
  it("unwraps every element and reads a missing periapsis as zero", () => {
    expect(elementsOf(orbit)).toEqual({
      sma: 700_000,
      ecc: 0.001,
      inc: 3,
      lan: 40,
      argPe: 0,
      meanAnomalyAtEpoch: 1.2,
      epoch: 500,
      mu: 3.5316e12,
    });
  });

  it("is null where a required element is not finite", () => {
    expect(elementsOf({ ...orbit, sma: value("m", Number.NaN) })).toBeNull();
  });
});

describe("patchNumbers and patchAround", () => {
  const patch = {
    sma: value("m", -190_000),
    ecc: value("1", 2.37),
    semiLatusRectum: value("m", 800_000),
    peA: value("m", 60_000),
    epoch: value("ut", 1_000),
    mu: value("m³/s²", 6.5e10),
    meanAnomalyAtEpoch: value("rad", -1.5),
    referenceBodyIndex: 2,
  };

  it("unwraps a patch", () => {
    expect(patchNumbers(patch as never)).toMatchObject({
      sma: -190_000,
      periapsisAltitude: 60_000,
      meanAnomalyAtEpoch: -1.5,
    });
  });

  it("finds the patch around a body, and none for another", () => {
    expect(patchAround({ patches: [patch as never] }, 2)).toBeDefined();
    expect(patchAround({ patches: [patch as never] }, 5)).toBeUndefined();
  });
});

describe("bodyNumbers and approachOf", () => {
  it("reads a body's radius and sphere of influence, and is null without both", () => {
    expect(
      bodyNumbers({
        radius: value("m", 200_000),
        sphereOfInfluence: value("m", 2.4e6),
      }),
    ).toEqual({ radius: 200_000, soi: 2.4e6 });
    expect(bodyNumbers({ radius: value("m", 200_000) })).toBeNull();
    expect(bodyNumbers(undefined)).toBeNull();
  });

  it("reads the closest approach, null without one", () => {
    expect(
      approachOf({
        closestApproach: {
          time: value("ut", 900),
          distance: value("m", 31),
          trajectoryKind: TrajectoryKind.Analytic,
        },
      }),
    ).toEqual({ time: 900, distance: 31 });
    expect(approachOf({ closestApproach: null })).toBeNull();
  });
});
