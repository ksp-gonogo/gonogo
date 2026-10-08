import {
  type BodyPose,
  type CelestialBody,
  isDeterministicValue,
  type SystemPoses,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { ephemerisFigureOf } from "./ephemerisFigure";

function pose(
  index: number,
  currency: BodyPose["currency"],
  asOfUt: number | null = null,
): BodyPose {
  return {
    index,
    currency,
    atUt: asOfUt ?? 1_000,
    asOfUt,
    untilUt: null,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trueAnomaly: 0,
  };
}

function posesOf(...entries: BodyPose[]): SystemPoses {
  const poseByIndex: Record<number, BodyPose> = {};
  for (const entry of entries) poseByIndex[entry.index] = entry;
  return { ut: 1_000, poseByIndex };
}

const body = (index: number) => ({ index }) as CelestialBody;
const FIGURE = value("°", 44);

describe("ephemerisFigureOf", () => {
  it("stamps a figure deterministic when every body is exact, and marks nothing", () => {
    const made = ephemerisFigureOf(
      posesOf(pose(1, "exact"), pose(2, "exact")),
      [body(1), body(2)],
    )(FIGURE);
    expect("state" in made).toBe(false);
    expect(isDeterministicValue(made)).toBe(true);
  });

  it("claims no exactness for a modelled body, and marks nothing", () => {
    const made = ephemerisFigureOf(
      posesOf(pose(1, "exact"), pose(2, "modelled")),
      [body(1), body(2)],
    )(FIGURE);
    expect("state" in made).toBe(false);
    expect(isDeterministicValue(made)).toBe(false);
  });

  it("hands over a figure held as of the oldest held body", () => {
    const made = ephemerisFigureOf(
      posesOf(pose(1, "held", 900), pose(2, "held", 400)),
      [body(1), body(2)],
    )(FIGURE);
    expect(made).toMatchObject({ state: "held", grade: "held" });
    if (!("state" in made)) throw new Error("expected a held figure");
    expect(made.asOfUt?.magnitude).toBe(400);
  });

  it("takes one held body to hold the figure, whichever of the two it is", () => {
    const made = ephemerisFigureOf(
      posesOf(pose(1, "exact"), pose(2, "held", 300)),
      [body(1), body(2)],
    )(FIGURE);
    expect("state" in made && made.state).toBe("held");
  });

  it("claims nothing before there are poses to rest on", () => {
    const made = ephemerisFigureOf(undefined, [body(1)])(FIGURE);
    expect("state" in made).toBe(false);
    expect(isDeterministicValue(made)).toBe(false);
  });
});
