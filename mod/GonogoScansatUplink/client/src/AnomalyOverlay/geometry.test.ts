import { describe, expect, it } from "vitest";
import type { SCANAnomalyEntry } from "../schema";
import {
  compassPoint,
  greatCircleMetres,
  initialBearingDeg,
  rankAnomaliesByDistance,
} from "./geometry";

const KERBIN_R = 600_000;

function anomaly(over: Partial<SCANAnomalyEntry>): SCANAnomalyEntry {
  return {
    name: "x",
    latitude: 0,
    longitude: 0,
    known: true,
    detail: false,
    ...over,
  };
}

describe("greatCircleMetres", () => {
  it("is zero for the same point", () => {
    expect(greatCircleMetres(10, 20, 10, 20, KERBIN_R)).toBe(0);
  });

  it("matches the quarter-circumference for a 90° separation along the equator", () => {
    const d = greatCircleMetres(0, 0, 0, 90, KERBIN_R);
    expect(d).toBeCloseTo((Math.PI / 2) * KERBIN_R, 0);
  });

  it("matches the half-circumference for antipodal points", () => {
    const d = greatCircleMetres(0, 0, 0, 180, KERBIN_R);
    expect(d).toBeCloseTo(Math.PI * KERBIN_R, 0);
  });
});

describe("initialBearingDeg", () => {
  it("is due north (0°) for a point directly north", () => {
    expect(initialBearingDeg(0, 0, 10, 0)).toBeCloseTo(0, 5);
  });

  it("is due east (90°) for a point on the equator to the east", () => {
    expect(initialBearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 5);
  });

  it("is due south (180°) for a point directly south", () => {
    expect(initialBearingDeg(0, 0, -10, 0)).toBeCloseTo(180, 5);
  });

  it("is due west (270°) for a point on the equator to the west", () => {
    expect(initialBearingDeg(0, 0, 0, -10)).toBeCloseTo(270, 5);
  });
});

describe("compassPoint", () => {
  it("maps cardinal + intercardinal bearings", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(45)).toBe("NE");
    expect(compassPoint(359)).toBe("N");
  });
});

describe("rankAnomaliesByDistance", () => {
  const far = anomaly({
    name: "Far",
    latitude: 0,
    longitude: 60,
    detail: true,
  });
  const near = anomaly({
    name: "Near",
    latitude: 0,
    longitude: 5,
    detail: true,
  });
  const undiscovered = anomaly({
    name: "Hidden",
    latitude: 0,
    longitude: 1,
    known: false,
  });

  it("excludes undiscovered anomalies", () => {
    const ranked = rankAnomaliesByDistance(
      [near, undiscovered],
      0,
      0,
      KERBIN_R,
    );
    expect(ranked.map((r) => r.anomaly.name)).toEqual(["Near"]);
  });

  it("sorts ascending by great-circle distance from the vessel", () => {
    const ranked = rankAnomaliesByDistance([far, near], 0, 0, KERBIN_R);
    expect(ranked.map((r) => r.anomaly.name)).toEqual(["Near", "Far"]);
    expect(ranked[0].distanceMetres).toBeLessThan(ranked[1].distanceMetres);
    expect(ranked[0].bearingDeg).toBeCloseTo(90, 5); // due east
  });

  it("falls back to name-only (NaN distances) when the vessel position is unknown", () => {
    const ranked = rankAnomaliesByDistance(
      [far, near],
      undefined,
      undefined,
      KERBIN_R,
    );
    expect(ranked.map((r) => r.anomaly.name)).toEqual(["Far", "Near"]);
    expect(Number.isNaN(ranked[0].distanceMetres)).toBe(true);
    expect(Number.isNaN(ranked[0].bearingDeg)).toBe(true);
  });
});
