import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { burnEffect, isBurning } from "./burnEffect";
import { currentBurnState } from "./crossSectionPlot";

const lit = {
  thrust: value("kN", 18),
  vesselMass: value("t", 5),
  pitch: value("°", 90),
  heading: value("°", 90),
  trackBearingDeg: 90,
};

describe("the effect of the burn that is lit", () => {
  it("is the thrust over the mass, along the way the nose points: straight up with the nose up", () => {
    const e = burnEffect(lit);
    expect(e?.up).toBeCloseTo(3.6, 9);
    expect(e?.along).toBeCloseTo(0, 9);
  });

  it("splits into up and along the track by pitch and by heading against the track's bearing", () => {
    // Nose 30 degrees above the horizon, pointing along the track.
    const along = burnEffect({ ...lit, pitch: value("°", 30) });
    expect(along?.up).toBeCloseTo(3.6 * 0.5, 9);
    expect(along?.along).toBeCloseTo(3.6 * Math.cos((30 * Math.PI) / 180), 9);
    // The same pitch pointing back along the track (a retro burn), and across it.
    const back = burnEffect({
      ...lit,
      pitch: value("°", 30),
      heading: value("°", 270),
    });
    expect(back?.along).toBeCloseTo(-(along?.along ?? 0), 9);
    const across = burnEffect({
      ...lit,
      pitch: value("°", 30),
      heading: value("°", 0),
    });
    expect(across?.along).toBeCloseTo(0, 9);
    expect(across?.up).toBeCloseTo(along?.up ?? 0, 9);
  });

  it("points down when the nose points below the horizon", () => {
    expect(burnEffect({ ...lit, pitch: value("°", -90) })?.up).toBeCloseTo(
      -3.6,
      9,
    );
  });

  it.each([
    ["no thrust", { thrust: null }],
    ["zero thrust", { thrust: value("kN", 0) }],
    ["negative thrust", { thrust: value("kN", -3) }],
    ["thrust that is not a number", { thrust: value("kN", Number.NaN) }],
    ["no mass", { vesselMass: null }],
    ["zero mass", { vesselMass: value("t", 0) }],
    ["no pitch", { pitch: null }],
    ["no heading", { heading: null }],
    ["a track with no bearing", { trackBearingDeg: null }],
  ])("is nothing, not a zero-length effect, with %s", (_name, over) => {
    expect(burnEffect({ ...lit, ...over })).toBeNull();
  });
});

describe("the burn state a plot is handed", () => {
  const propulsion = {
    currentThrust: value("kN", 18),
    totalMass: value("t", 5),
  };
  const attitude = { pitch: value("°", 80), heading: value("°", 270) };

  it("reads the thrust, the mass and the nose from readings of now", () => {
    expect(
      currentBurnState(
        { state: "observed", value: propulsion },
        { state: "observed", value: attitude },
      ),
    ).toEqual({
      thrust: propulsion.currentThrust,
      vesselMass: propulsion.totalMass,
      pitch: attitude.pitch,
      heading: attitude.heading,
    });
  });

  it.each([
    [
      "held thrust",
      { state: "held", value: propulsion },
      { state: "observed", value: attitude },
    ],
    [
      "a held attitude",
      { state: "observed", value: propulsion },
      { state: "held", value: attitude },
    ],
    [
      "thrust never seen",
      { state: "absent" },
      { state: "observed", value: attitude },
    ],
    [
      "no attitude yet",
      { state: "observed", value: propulsion },
      { state: "absent" },
    ],
  ])("is nothing with %s: it is not a burn that is lit", (_name, p, a) => {
    expect(currentBurnState(p, a)).toBeNull();
  });
});

describe("whether the engines are lit", () => {
  const thrust = (kn: number) => ({ currentThrust: value("kN", kn) });

  it("is true from a reading of now above zero, and no other", () => {
    expect(isBurning({ state: "observed", value: thrust(18) })).toBe(true);
    expect(isBurning({ state: "observed", value: thrust(0) })).toBe(false);
  });

  it("is never true from a held reading or none: a guess is not a burn", () => {
    expect(isBurning({ state: "held", value: thrust(18) })).toBe(false);
    expect(isBurning({ state: "absent" })).toBe(false);
  });
});
