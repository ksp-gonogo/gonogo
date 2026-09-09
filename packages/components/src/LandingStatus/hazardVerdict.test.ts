import { type UncertaintyBand, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveHazardVerdict } from "./hazardVerdict";

describe("deriveHazardVerdict", () => {
  it("is SAFE when every axis is in the safe band", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 3,
      roughnessSigma: 30,
      verticalSpeed: 1.5,
      lateralSpeed: 0.5,
    });
    expect(r.verdict).toBe("SAFE");
  });

  it("worst-band-wins: one MARGINAL axis makes the site MARGINAL", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 10, // MARGINAL (5-15)
      roughnessSigma: 30, // SAFE
      verticalSpeed: 1, // SAFE
      lateralSpeed: 0.5, // SAFE
    });
    expect(r.verdict).toBe("MARGINAL");
    expect(r.axes[0]).toMatchObject({ axis: "slope", band: "MARGINAL" });
  });

  it("worst-band-wins: one DIVERT axis makes the site DIVERT", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 4,
      roughnessSigma: 30,
      verticalSpeed: 8, // DIVERT (>6)
      lateralSpeed: 0.5,
    });
    expect(r.verdict).toBe("DIVERT");
    expect(r.axes[0].axis).toBe("vertical");
  });

  it("forces DIVERT on a water biome regardless of the numbers", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 0,
      roughnessSigma: 5,
      verticalSpeed: 0.5,
      lateralSpeed: 0.1,
      biome: "Water",
    });
    expect(r.verdict).toBe("DIVERT");
    expect(r.axes[0]).toMatchObject({ axis: "biome" });
  });

  it("grades roughness on the shared A/B/C/F scale (F is DIVERT)", () => {
    expect(deriveHazardVerdict({ roughnessSigma: 500 }).verdict).toBe("DIVERT");
    expect(deriveHazardVerdict({ roughnessSigma: 200 }).verdict).toBe(
      "MARGINAL",
    );
    expect(deriveHazardVerdict({ roughnessSigma: 40 }).verdict).toBe("SAFE");
  });

  it("returns a null verdict when no axis has data (unknown, not safe)", () => {
    expect(deriveHazardVerdict({}).verdict).toBeNull();
  });

  it("grades a reading landing exactly on a threshold as the safer band", () => {
    // The table in this module's header reads `<=5` for SAFE and `5-15` for
    // MARGINAL, so 5 is SAFE and only something above it is not. Pinned
    // because the ladder is three comparisons and nothing else here lands on
    // a boundary: flipping one of them to strict leaves every other case in
    // this file passing.
    expect(deriveHazardVerdict({ slopeDeg: 5 }).verdict).toBe("SAFE");
    expect(deriveHazardVerdict({ slopeDeg: 15 }).verdict).toBe("MARGINAL");
    expect(deriveHazardVerdict({ verticalSpeed: 2 }).verdict).toBe("SAFE");
    expect(deriveHazardVerdict({ verticalSpeed: 6 }).verdict).toBe("MARGINAL");
    expect(deriveHazardVerdict({ lateralSpeed: 1 }).verdict).toBe("SAFE");
    expect(deriveHazardVerdict({ lateralSpeed: 3 }).verdict).toBe("MARGINAL");
  });

  it("honours per-instance tuned slope thresholds", () => {
    // A wide-base rover: raise the slope tolerance so 12° reads SAFE.
    const r = deriveHazardVerdict(
      { slopeDeg: 12 },
      {
        slope: [value("°", 20), value("°", 30)],
        vertical: [value("m/s", 2), value("m/s", 6)],
        lateral: [value("m/s", 1), value("m/s", 3)],
      },
    );
    expect(r.verdict).toBe("SAFE");
  });
});

/**
 * The band, used as a DECISION rather than a picture.
 *
 * Every case here holds the point estimate fixed and varies only the interval
 * around it, because that is the whole claim: the same reading grades the same
 * way until the model admits it does not know which side of a line it is on.
 */
describe("deriveHazardVerdict: an axis whose band spans a threshold", () => {
  const mps = (lo: number, v: number, hi: number): UncertaintyBand<"m/s"> => ({
    value: value("m/s", v),
    lo: value("m/s", lo),
    hi: value("m/s", hi),
    kind: "sigma1",
  });

  it("still grades on the point estimate while the interval stays in one band", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 4,
      verticalSpeedBand: mps(3.2, 4, 5.4),
    });
    expect(r.verdict).toBe("MARGINAL");
    expect(r.axes[0]).toMatchObject({ axis: "vertical", band: "MARGINAL" });
  });

  it("cannot say when the interval spans the DIVERT line", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 5.8,
      verticalSpeedBand: mps(4, 5.8, 9),
    });
    expect(r.verdict).toBe("UNRESOLVED");
    expect(r.axes[0]).toMatchObject({
      axis: "vertical",
      band: "UNRESOLVED",
      worstPossible: "DIVERT",
    });
  });

  it("names the interval that stopped it, so the line is not read as a settled figure", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 5.8,
      verticalSpeedBand: mps(4, 5.8, 9),
    });
    expect(r.axes[0].detail).toContain("could be");
    expect(r.axes[0].detail).toContain("9.0");
  });

  /*
   * The rule that keeps the fourth verdict worth having. A certain DIVERT is
   * actionable and an unresolved axis that could at worst reach DIVERT adds
   * nothing to it, so the board must not downgrade a firm answer to a shrug.
   */
  it("keeps a certain DIVERT rather than downgrading it to UNRESOLVED", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 5.8,
      verticalSpeedBand: mps(4, 5.8, 9),
      biome: "Water",
    });
    expect(r.verdict).toBe("DIVERT");
    // The axis itself is still honestly unresolved; only the verdict is not.
    expect(r.axes.find((a) => a.axis === "vertical")?.band).toBe("UNRESOLVED");
  });

  it("goes UNRESOLVED when the open axis could beat the worst certain one", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 10, // certainly MARGINAL
      verticalSpeed: 5.8,
      verticalSpeedBand: mps(4, 5.8, 9), // could be DIVERT
    });
    expect(r.verdict).toBe("UNRESOLVED");
  });

  it("stays MARGINAL when the open axis cannot beat the worst certain one", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 10, // certainly MARGINAL
      verticalSpeed: 1.8,
      verticalSpeedBand: mps(1.4, 1.8, 3.5), // SAFE or MARGINAL, never worse
    });
    expect(r.verdict).toBe("MARGINAL");
  });

  /*
   * A reckoned rate crosses zero constantly (a descent rate at the top of a
   * hop, a lateral rate as it nulls), and the ladder grades the MAGNITUDE. The
   * magnitude of [-1, 4] reaches 0, not 1, so mapping the ends alone would
   * assert the craft is definitely still moving.
   */
  it("takes the magnitude of an interval that crosses zero, not the magnitudes of its ends", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 0.5,
      verticalSpeedBand: mps(-1, 0.5, 4),
    });
    // |v| runs 0 to 4, which spans the 2 m/s SAFE line: unresolved.
    expect(r.verdict).toBe("UNRESOLVED");
    expect(r.axes[0].detail).toContain("0.0");
  });

  it("resolves a zero-crossing interval that stays inside one band", () => {
    const r = deriveHazardVerdict({
      verticalSpeed: 0.2,
      verticalSpeedBand: mps(-1.5, 0.2, 1.5),
    });
    // |v| runs 0 to 1.5, wholly under the 2 m/s SAFE line.
    expect(r.verdict).toBe("SAFE");
  });

  it("is unchanged by a band on an axis that has no reading", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 3,
      verticalSpeedBand: mps(4, 5.8, 9),
    });
    expect(r.verdict).toBe("SAFE");
    expect(r.axes).toHaveLength(1);
  });
});
