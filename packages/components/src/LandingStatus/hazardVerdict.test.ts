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

  it("honours per-instance tuned slope thresholds", () => {
    // A wide-base rover: raise the slope tolerance so 12° reads SAFE.
    const r = deriveHazardVerdict(
      { slopeDeg: 12 },
      { slope: [20, 30], vertical: [2, 6], lateral: [1, 3] },
    );
    expect(r.verdict).toBe("SAFE");
  });
});
