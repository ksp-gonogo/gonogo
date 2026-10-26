import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import {
  type ConicBodiesInput,
  type ConicOrbitInput,
  type ConicPendingInput,
  type ConicThrustInput,
  keplerAdmissibility,
} from "./kepler-reckoning";

/**
 * `keplerAdmissibility` against `mod/golden-fixtures/kepler-admissibility.json`,
 * the file the mod's C# twin is held to as well. A change here that moves an
 * answer fails until the fixture is regenerated, which then fails the C# side
 * until the twin agrees.
 */

interface FixtureCase {
  id: string;
  orbitPoint?: {
    validAt: number;
    quality: keyof typeof Quality;
    payload: ConicOrbitInput | null;
  };
  bodies?: ConicBodiesInput;
  viewUt: number;
  coast?: { thrust?: ConicThrustInput; pending?: ConicPendingInput };
  expected: unknown;
}

const NON_FINITE: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/* Narrowed rather than asserted: a fixture that has drifted out of shape
   fails here, naming the case. The inputs inside it are left as the wire
   would carry them, since reading absent and non-finite figures is what
   the function under test is held to. */
function isFixtureCase(value: unknown): value is FixtureCase {
  if (!isObject(value)) return false;
  const { id, orbitPoint, bodies, viewUt, coast, expected } = value;
  return (
    typeof id === "string" &&
    typeof viewUt === "number" &&
    isObject(expected) &&
    (orbitPoint === undefined ||
      (isObject(orbitPoint) &&
        typeof orbitPoint.validAt === "number" &&
        typeof orbitPoint.quality === "string" &&
        orbitPoint.quality in Quality &&
        (orbitPoint.payload === null || isObject(orbitPoint.payload)))) &&
    (bodies === undefined ||
      (isObject(bodies) && Array.isArray(bodies.bodies))) &&
    (coast === undefined || isObject(coast))
  );
}

function readCases(json: unknown): FixtureCase[] {
  if (!isObject(json) || !Array.isArray(json.cases)) {
    throw new Error(
      'golden-fixtures/kepler-admissibility.json: no "cases" array',
    );
  }
  return json.cases.map((entry: unknown, index) => {
    if (!isFixtureCase(entry)) {
      throw new Error(
        `golden-fixtures/kepler-admissibility.json: case ${index} is not a FixtureCase`,
      );
    }
    return entry;
  });
}

const cases = readCases(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../golden-fixtures/kepler-admissibility.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    (_key, value) =>
      typeof value === "string" && value in NON_FINITE
        ? NON_FINITE[value]
        : value,
  ),
);

describe("keplerAdmissibility golden fixture", () => {
  it("covers every condition", () => {
    expect(cases.length).toBeGreaterThanOrEqual(70);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const point: TimelinePoint<ConicOrbitInput> | undefined =
      c.orbitPoint === undefined
        ? undefined
        : {
            validAt: c.orbitPoint.validAt,
            payload: c.orbitPoint.payload,
            meta: makeMeta({
              validAt: c.orbitPoint.validAt,
              deliveredAt: c.orbitPoint.validAt,
              quality: Quality[c.orbitPoint.quality],
            }),
            epoch: 0,
          };
    const coast =
      c.coast === undefined
        ? undefined
        : { thrust: c.coast.thrust, pending: c.coast.pending };
    expect(keplerAdmissibility(point, c.bodies, c.viewUt, coast)).toEqual(
      c.expected,
    );
  });
});
