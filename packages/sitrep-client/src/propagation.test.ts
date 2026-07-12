import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type OrbitElements, solve } from "./kepler";

/**
 * Cross-language conformance test: asserts this TS `solve()` matches EVERY
 * case in `mod/golden-fixtures/propagation.json` -- the same fixture file
 * `Sitrep.Propagation.Tests` asserts `KeplerProvider` against. Both
 * languages conforming to one shared fixture set is how we prove the C#
 * server and the TS SDK derive positions IDENTICALLY (spec-streaming-delay-model.md
 * §4/§5's derived-channel requirement).
 *
 * Per-case `tolerance` in the fixture distinguishes:
 *  - "csharp-generated" cases: KeplerProvider's own (near machine-precision)
 *    output -- tight relative tolerance (1e-9).
 *  - "published-reference" case (the Vallado COE2RV worked example):
 *    externally-published, 6-significant-figure values -- looser relative
 *    tolerance (1e-3), matching what `KnownInertialVectorTests.cs` uses for
 *    the same case on the C# side.
 */

interface FixtureCase {
  id: string;
  description: string;
  source: string;
  tolerance: number;
  elements: OrbitElements;
  ut: number;
  expected: {
    position: [number, number, number];
    velocity: [number, number, number];
  };
}

interface FixtureFile {
  cases: FixtureCase[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(
  currentDir,
  "../../../mod/golden-fixtures/propagation.json",
);
const fixtures: FixtureFile = JSON.parse(readFileSync(fixturesPath, "utf-8"));

function assertVectorRelativelyClose(
  expected: readonly number[],
  actual: readonly number[],
  tolerance: number,
  label: string,
): void {
  const axisNames = ["x", "y", "z"];
  for (let i = 0; i < 3; i++) {
    const scale = Math.max(Math.abs(expected[i]), 1.0);
    const relativeDiff = Math.abs(actual[i] - expected[i]) / scale;
    expect(
      relativeDiff,
      `${label}.${axisNames[i]}: expected ${expected[i]}, got ${actual[i]} (relative diff ${relativeDiff.toExponential(3)}, tolerance ${tolerance.toExponential(3)})`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

describe("kepler propagation conformance vs. C# KeplerProvider (golden fixtures)", () => {
  it("loaded the full golden-fixture case set", () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(7);
    expect(fixtures.cases.map((c) => c.id)).toContain(
      "vallado-coe2rv-earth-tilted",
    );
  });

  for (const testCase of fixtures.cases) {
    it(`matches ${testCase.source} case: ${testCase.id}`, () => {
      const result = solve(testCase.elements, testCase.ut);

      assertVectorRelativelyClose(
        testCase.expected.position,
        result.position,
        testCase.tolerance,
        `${testCase.id}.position`,
      );
      assertVectorRelativelyClose(
        testCase.expected.velocity,
        result.velocity,
        testCase.tolerance,
        `${testCase.id}.velocity`,
      );
    });
  }
});
