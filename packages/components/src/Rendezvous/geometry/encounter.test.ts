import { describe, expect, it } from "vitest";
import {
  craftOnPatch,
  encounterGeometry,
  type PatchNumbers,
  timeToPeriapsis,
} from "./encounter";

const MUN = { radius: 200_000, soi: 2_429_559 };
// A flyby with periapsis 260 km from the Mun's centre.
const flyby: PatchNumbers = {
  sma: -190_000,
  ecc: 2.37,
  semiLatusRectum: 190_000 * (2.37 ** 2 - 1),
  periapsisAltitude: 60_000,
  meanAnomalyAtEpoch: -1.5,
  epoch: 1_000,
  mu: 6.5138398e10,
};

describe("encounterGeometry", () => {
  it("runs a flyby from the sphere's edge in to periapsis and out to the edge", () => {
    const g = encounterGeometry(flyby, MUN);
    expect(g).not.toBeNull();
    expect(Math.hypot(...(g?.entry ?? [0, 0]))).toBeCloseTo(MUN.soi, 0);
    expect(Math.hypot(...(g?.exit ?? [0, 0]))).toBeCloseTo(MUN.soi, 0);
    expect(g?.path).toHaveLength(121);
  });

  it("puts periapsis straight up at the conic's periapsis distance", () => {
    const g = encounterGeometry(flyby, MUN);
    const rp = flyby.semiLatusRectum / (1 + flyby.ecc);
    expect(g?.periapsis.point[0]).toBeCloseTo(0, 6);
    expect(g?.periapsis.point[1]).toBeCloseTo(rp, 3);
    expect(g?.periapsis.altitude).toBe(60_000);
  });

  it("draws a captured orbit whole, with no entry or exit", () => {
    const g = encounterGeometry(
      {
        ...flyby,
        sma: 400_000,
        ecc: 0.3,
        semiLatusRectum: 400_000 * (1 - 0.09),
      },
      MUN,
    );
    expect(g?.entry).toBeNull();
    expect(g?.exit).toBeNull();
    expect(g?.path).toHaveLength(181);
  });

  it("is null for a conic that never reaches the sphere, and for unknown numbers", () => {
    expect(
      encounterGeometry({ ...flyby, ecc: 1.0001, semiLatusRectum: 9e9 }, MUN),
    ).toBeNull();
    expect(encounterGeometry(flyby, { radius: 0, soi: MUN.soi })).toBeNull();
    expect(
      encounterGeometry({ ...flyby, semiLatusRectum: Number.NaN }, MUN),
    ).toBeNull();
  });
});

describe("timeToPeriapsis", () => {
  it("counts down for a hyperbola still inbound and goes negative after it", () => {
    const before = timeToPeriapsis(flyby, 1_000) ?? 0;
    expect(before).toBeGreaterThan(0);
    expect(timeToPeriapsis(flyby, 1_000 + before + 10)).toBeLessThan(0);
  });

  it("is null without a mean motion", () => {
    expect(timeToPeriapsis({ ...flyby, sma: 0 }, 0)).toBeNull();
  });
});

describe("craftOnPatch", () => {
  it("puts the craft at periapsis when the mean anomaly is zero", () => {
    const at = craftOnPatch(
      { ...flyby, meanAnomalyAtEpoch: 0 },
      MUN.soi,
      1_000,
    );
    const rp = flyby.semiLatusRectum / (1 + flyby.ecc);
    expect(at?.[0]).toBeCloseTo(0, 3);
    expect(at?.[1]).toBeCloseTo(rp, 0);
  });

  it("is null while the craft is outside the sphere or when no time is given", () => {
    expect(
      craftOnPatch({ ...flyby, meanAnomalyAtEpoch: -40 }, MUN.soi, 1_000),
    ).toBeNull();
    expect(craftOnPatch(flyby, MUN.soi, undefined)).toBeNull();
  });

  it("travels to the left of periapsis-up as time passes, as the path is drawn", () => {
    const before = craftOnPatch(
      { ...flyby, meanAnomalyAtEpoch: -0.3 },
      MUN.soi,
      1_000,
    );
    const after = craftOnPatch(
      { ...flyby, meanAnomalyAtEpoch: 0.3 },
      MUN.soi,
      1_000,
    );
    expect(before?.[0] ?? 0).toBeGreaterThan(0);
    expect(after?.[0] ?? 0).toBeLessThan(0);
  });
});
