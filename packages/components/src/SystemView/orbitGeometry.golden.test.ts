import { describe, expect, it } from "vitest";
import GOLDEN from "./__fixtures__/orbitGeometry-golden.json";
import {
  orbitPointAt,
  orbitRingPoints,
  perifocalToParent,
} from "./orbitGeometry";

const ANGLES: readonly (readonly [lan: number, argPe: number, inc: number])[] =
  [
    [0, 0, 0],
    [30, 45, 15],
    [200, 310, 98],
    [91, 270, 63.4],
    [350, 12, 150],
  ];

const POINTS: readonly (readonly [number, number, number])[] = [
  [1_000_000, 0, 0],
  [-250_000, 800_000, 0],
  [420_000, -1_300_000, 55_000],
  [0, 0, -90_000],
];

/**
 * The rotation is shared with the SDK's, which composes the three turns as one
 * matrix where this file used to apply them in sequence. The two agree to
 * floating-point rounding (metres of the order 1e6, so 1e-9 is a few ulps), not
 * to the last bit.
 */
function metresOf(nested: readonly unknown[]): number[] {
  return nested
    .flat(Number.POSITIVE_INFINITY)
    .filter((x): x is number => typeof x === "number");
}

function expectSameMetres(
  actual: readonly unknown[],
  golden: readonly unknown[],
): void {
  const got = metresOf(actual);
  const want = metresOf(golden);
  expect(got).toHaveLength(want.length);
  got.forEach((value, i) => {
    expect(Math.abs(value - want[i])).toBeLessThan(1e-9);
  });
}

describe("SystemView orbit geometry keeps its numbers", () => {
  it("perifocalToParent", () => {
    const actual = ANGLES.flatMap(([lan, argPe, inc]) =>
      POINTS.map(([x, y, z]) => perifocalToParent(x, y, lan, argPe, inc, z)),
    );
    expectSameMetres(actual, GOLDEN.perifocalToParent);
  });

  it("orbitPointAt and orbitRingPoints", () => {
    const at = ANGLES.flatMap(([lan, argPe, inc]) =>
      [0, 77, 180, 291].map((nu) =>
        orbitPointAt(900_000, 0.35, lan, argPe, inc, nu),
      ),
    );
    const ring = ANGLES.map(([lan, argPe, inc]) =>
      orbitRingPoints(900_000, 0.35, lan, argPe, inc, 8),
    );
    expectSameMetres(
      [at, ring],
      [GOLDEN.orbitPoints.at, GOLDEN.orbitPoints.ring],
    );
  });
});
