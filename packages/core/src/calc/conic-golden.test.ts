import { type PatchConic, patchStateAt } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import GOLDEN from "./__fixtures__/conic-golden.json";
import { stateAtUT } from "./maneuver";

const KERBIN_MU = 3.5316e12;

interface Shape {
  sma: number;
  ecc: number;
  inc: number;
  lan: number;
  argPe: number;
  m0: number;
}

const SHAPES: readonly Shape[] = [
  { sma: 700_000, ecc: 0, inc: 0, lan: 0, argPe: 0, m0: 0 },
  { sma: 700_000, ecc: 0.1, inc: 15, lan: 30, argPe: 45, m0: 0.5 },
  { sma: 1_250_000, ecc: 0.45, inc: 98, lan: 200, argPe: 310, m0: 5.9 },
  { sma: 9_000_000, ecc: 0.9, inc: 63.4, lan: 91, argPe: 270, m0: 3.1 },
  { sma: 4_000_000, ecc: 0.97, inc: 150, lan: 350, argPe: 12, m0: 0.05 },
];

const OFFSETS = [-90_000, -1234.5, 0, 17.25, 2000, 33_333, 5_000_000];

function conicOf(shape: Shape): PatchConic {
  return {
    sma: value("m", shape.sma),
    ecc: value("1", shape.ecc),
    inc: value("°", shape.inc),
    lan: value("°", shape.lan),
    argPe: value("°", shape.argPe),
    meanAnomalyAtEpoch: value("rad", shape.m0),
    epoch: value("ut", 100),
    // A period a hair off 2π√(a³/μ): the patch keeps the game's own figure.
    period: value(
      "s",
      2 * Math.PI * Math.sqrt(shape.sma ** 3 / KERBIN_MU) * (1 + 3e-9),
    ),
  };
}

describe("one conic arithmetic path keeps its numbers", () => {
  it("patchStateAt", () => {
    const actual = SHAPES.flatMap((shape) =>
      OFFSETS.map((dt) => {
        const s = patchStateAt(conicOf(shape), 100 + dt);
        return [s.x, s.y, s.z, s.radius];
      }),
    );
    expect(actual).toEqual(GOLDEN.patchStateAt);
  });

  it("stateAtUT", () => {
    const actual = SHAPES.flatMap((shape) =>
      OFFSETS.map((dt) => {
        const ApR = shape.sma * (1 + shape.ecc);
        const PeR = shape.sma * (1 - shape.ecc);
        const s = stateAtUT(
          {
            sma: shape.sma,
            eccentricity: shape.ecc,
            ApR,
            PeR,
            timeToAp: value("s", 0),
            timeToPe: value("s", 0),
          },
          shape.m0 * 20,
          KERBIN_MU,
          value("ut", 100),
          value("ut", 100 + dt),
        );
        return s && [s.r, s.speed, s.flightPathAngle, s.trueAnomalyDeg];
      }),
    );
    expect(actual).toEqual(GOLDEN.stateAtUT);
  });
});
