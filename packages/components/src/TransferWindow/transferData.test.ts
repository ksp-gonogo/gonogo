import { describe, expect, it } from "vitest";
import type { CelestialBody } from "../SystemView/useCelestialBodies";
import {
  bodyTrueLongitudeDeg,
  buildTransferPorkchop,
  celestialToOrbitElements,
  computeTransfer,
  parentMu,
  phaseAngleDeg,
  transferDestinations,
} from "./transferData";

const MU_SUN = 1.32712440018e20;
const MU_EARTH = 3.986004418e14;
const MU_MARS = 4.282837e13;
const DAY = 86400;
const DEG = Math.PI / 180;

function mkBody(
  over: Partial<CelestialBody> & { index: number },
): CelestialBody {
  return {
    index: over.index,
    name: null,
    referenceBody: null,
    radius: null,
    soi: null,
    gravParameter: null,
    semiMajorAxis: null,
    eccentricity: null,
    inclination: null,
    lan: null,
    argumentOfPeriapsis: null,
    meanAnomalyAtEpoch: null,
    epoch: null,
    period: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
    ...over,
  };
}

const sun = mkBody({ index: 0, name: "Sun", gravParameter: MU_SUN });
const earth = mkBody({
  index: 1,
  name: "Earth",
  referenceBody: "Sun",
  gravParameter: MU_EARTH,
  semiMajorAxis: 1.495978707e11,
  eccentricity: 0,
  inclination: 0,
  lan: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  period: 365.256 * DAY,
  trueAnomaly: 0,
});
const mars = mkBody({
  index: 2,
  name: "Mars",
  referenceBody: "Sun",
  gravParameter: MU_MARS,
  semiMajorAxis: 2.279392e11,
  eccentricity: 0,
  inclination: 0,
  lan: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: 44.3 * DEG,
  epoch: 0,
  period: 686.98 * DAY,
  trueAnomaly: 44.3,
});
const bodies = [sun, earth, mars];

describe("transferData bridge", () => {
  it("parentMu resolves the shared parent's μ", () => {
    expect(parentMu(earth, bodies)).toBe(MU_SUN);
    expect(parentMu(sun, bodies)).toBeNull();
  });

  it("bodyTrueLongitudeDeg = (Ω+ω)+ν, wrapped", () => {
    expect(bodyTrueLongitudeDeg(earth)).toBeCloseTo(0, 6);
    expect(bodyTrueLongitudeDeg(mars)).toBeCloseTo(44.3, 6);
  });

  it("phaseAngleDeg = dest longitude − origin longitude", () => {
    expect(phaseAngleDeg(earth, mars)).toBeCloseTo(44.3, 6);
  });

  it("celestialToOrbitElements carries the parent μ + raw (radian) elements", () => {
    const el = celestialToOrbitElements(mars, bodies);
    expect(el).not.toBeNull();
    if (!el) return;
    expect(el.mu).toBe(MU_SUN);
    expect(el.sma).toBe(2.279392e11);
    expect(el.meanAnomalyAtEpoch).toBeCloseTo(44.3 * DEG, 9);
  });

  it("celestialToOrbitElements returns null when elements are missing", () => {
    expect(celestialToOrbitElements(sun, bodies)).toBeNull();
  });

  it("transferDestinations lists same-parent siblings only", () => {
    expect(transferDestinations(earth, bodies).map((b) => b.name)).toEqual([
      "Mars",
    ]);
    // Sun (no parent) has no siblings here
    expect(transferDestinations(sun, bodies)).toEqual([]);
  });

  it("computeTransfer produces a GO solution when phase sits on the ideal", () => {
    const sol = computeTransfer({
      origin: earth,
      dest: mars,
      bodies,
      parkingRadius: 6.571e6,
      nowUt: 0,
    });
    expect(sol).not.toBeNull();
    if (!sol) return;
    expect(sol.status).toBe("go");
    expect(sol.ejectionDeltaV).toBeCloseTo(3613, -2);
  });

  it("buildTransferPorkchop returns a grid with a finite best cell", () => {
    const grid = buildTransferPorkchop({
      origin: earth,
      dest: mars,
      bodies,
      nowUt: 0,
      departureSamples: 12,
      arrivalSamples: 12,
    });
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.cells).toHaveLength(12);
    expect(grid.best).not.toBeNull();
    expect(grid.best && Number.isFinite(grid.best.deltaV)).toBe(true);
    expect(grid.best && grid.best.deltaV > 0).toBe(true);
  });
});
