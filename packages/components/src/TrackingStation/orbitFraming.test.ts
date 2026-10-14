import { describe, expect, it } from "vitest";
import { orbitFramingZoom } from "./orbitFraming";

const BASE = {
  frameName: "Kerbin",
  plotScale: 1e-6,
  halfPicturePlotUnits: 100,
};

describe("orbitFramingZoom", () => {
  it("fits the apoapsis about the frame body with a margin", () => {
    const orbit = { parentName: "Kerbin", sma: 4e6, ecc: 0.5 };
    // Apoapsis 6 Mm: 6 plot units, with the 1.25 margin 7.5, in a picture 100 units to the edge.
    expect(orbitFramingZoom({ ...BASE, orbit })).toBeCloseTo(100 / 7.5, 6);
  });

  it("zooms out to the far side of the orbit when the picture is centred on the craft", () => {
    const orbit = { parentName: "Kerbin", sma: 8e6, ecc: 0 };
    const onBody = orbitFramingZoom({ ...BASE, orbit });
    const onCraft = orbitFramingZoom({ ...BASE, orbit, centredOnCraft: 90 });
    // A circular orbit's far side is a diameter from the craft, twice its radius.
    expect(onBody).not.toBeNull();
    expect(onCraft).toBeCloseTo((onBody ?? 0) / 2, 6);
  });

  it("measures the craft's distance at its own place on an eccentric orbit", () => {
    const orbit = { parentName: "Kerbin", sma: 4e6, ecc: 0.5 };
    const atPeriapsis = orbitFramingZoom({
      ...BASE,
      orbit,
      centredOnCraft: 0,
    });
    const atApoapsis = orbitFramingZoom({
      ...BASE,
      orbit,
      centredOnCraft: 180,
    });
    // Periapsis 2 Mm, apoapsis 6 Mm: the reach is 8 Mm from either end.
    expect(atPeriapsis).toBeCloseTo(100 / (8 * 1.25), 6);
    expect(atApoapsis).toBeCloseTo(100 / (12 * 1.25), 6);
  });

  it("has no framing for an open orbit or an orbit about another body", () => {
    expect(
      orbitFramingZoom({
        ...BASE,
        orbit: { parentName: "Kerbin", sma: -4e6, ecc: 1.5 },
      }),
    ).toBeNull();
    expect(
      orbitFramingZoom({
        ...BASE,
        orbit: { parentName: "Mun", sma: 4e5, ecc: 0 },
      }),
    ).toBeNull();
  });
});
