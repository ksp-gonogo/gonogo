import { ANALYTIC_BODY_HORIZON } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { buildRows } from "./almanacRows";
import type { CelestialBody } from "./useCelestialBodies";

function kerbin(deterministic: boolean): CelestialBody {
  return {
    index: 1,
    name: "Kerbin",
    referenceBody: "Kerbol",
    radius: 600_000,
    soi: 84_159_286,
    gravParameter: 3.5316e12,
    semiMajorAxis: 13_599_840_256,
    eccentricity: 0,
    inclination: 0,
    lan: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: 3.14,
    epoch: 0,
    horizon: ANALYTIC_BODY_HORIZON,
    deterministic,
    period: 9_203_545,
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
  };
}

const HELD = { asOfUt: 100, grade: "unknown" } as never;

function heldLabels(deterministic: boolean): string[] {
  const rows = buildRows(
    kerbin(deterministic),
    null,
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    HELD,
  );
  return rows
    .filter((row) => {
      const { container } = render(<div>{row.value}</div>);
      return container.querySelector("[data-held]") !== null;
    })
    .map((row) => row.label);
}

describe("almanac rows off a catalogue that has stopped arriving", () => {
  it("leaves a stock body's orbital elements unmarked, since they never change", () => {
    const held = heldLabels(true);
    expect(held).not.toContain("SOI");
    expect(held).not.toContain("Eccentricity");
    expect(held).not.toContain("Inclination");
    expect(held).not.toContain("Orbital period");
  });

  it("marks the same elements held when the body's orbit is not deterministic", () => {
    const held = heldLabels(false);
    expect(held).toEqual(
      expect.arrayContaining([
        "SOI",
        "Eccentricity",
        "Inclination",
        "Orbital period",
      ]),
    );
  });
});
