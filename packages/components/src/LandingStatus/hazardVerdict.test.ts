import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveHazardVerdict } from "./hazardVerdict";

describe("deriveHazardVerdict", () => {
  it("is SAFE when every axis is in the safe band", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 3,
      roughnessSigma: 30,
      touchdownSpeed: 1.5,
    });
    expect(r.verdict).toBe("SAFE");
  });

  it("worst-band-wins: one MARGINAL axis makes the site MARGINAL", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 10, // MARGINAL (5-15)
      roughnessSigma: 30, // SAFE
      touchdownSpeed: 1, // SAFE
    });
    expect(r.verdict).toBe("MARGINAL");
    expect(r.axes[0]).toMatchObject({ axis: "slope", band: "MARGINAL" });
  });

  it("worst-band-wins: one DIVERT axis makes the site DIVERT", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 4,
      roughnessSigma: 30,
      touchdownSpeed: 8, // DIVERT (>6)
    });
    expect(r.verdict).toBe("DIVERT");
    expect(r.axes[0].axis).toBe("touchdown");
  });

  it("judges a descent by its touchdown speed alone: the same figures give the same verdict for any craft", () => {
    // There is no input for a surface, an engine or a parachute: a flat site at a soft touchdown is SAFE, and a fast one is not.
    expect(
      deriveHazardVerdict({
        slopeDeg: 0,
        roughnessSigma: 5,
        touchdownSpeed: 0.5,
      }).verdict,
    ).toBe("SAFE");
    expect(
      deriveHazardVerdict({ slopeDeg: 0, roughnessSigma: 5, touchdownSpeed: 7 })
        .verdict,
    ).toBe("DIVERT");
  });

  it("says nothing of water: a flat site at a gentle touchdown is SAFE whatever lies under it", () => {
    const r = deriveHazardVerdict({
      slopeDeg: 0,
      roughnessSigma: 0,
      touchdownSpeed: 6.5,
    });
    expect(r.axes.map((a) => a.axis)).toEqual([
      "touchdown",
      "slope",
      "roughness",
    ]);
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
    // The ladder is three comparisons, and only this case lands on a boundary, so flipping one to strict would otherwise pass unnoticed.
    expect(deriveHazardVerdict({ slopeDeg: 5 }).verdict).toBe("SAFE");
    expect(deriveHazardVerdict({ slopeDeg: 15 }).verdict).toBe("MARGINAL");
    expect(deriveHazardVerdict({ touchdownSpeed: 2 }).verdict).toBe("SAFE");
    expect(deriveHazardVerdict({ touchdownSpeed: 6 }).verdict).toBe("MARGINAL");
  });

  it("honours per-instance tuned thresholds", () => {
    // A wide-base rover raises the slope tolerance so 12 degrees reads SAFE.
    const r = deriveHazardVerdict(
      { slopeDeg: 12 },
      {
        slope: [value("°", 20), value("°", 30)],
        touchdown: [value("m/s", 2), value("m/s", 6)],
      },
    );
    expect(r.verdict).toBe("SAFE");
  });
});
