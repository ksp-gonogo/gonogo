#!/usr/bin/env tsx
/**
 * Golden-fixture generator for `mod/sitrep-kernel/src/version.ts`.
 *
 * Imports the REAL TS reference functions, runs them over a fixed set of
 * input cases, and writes the TS-computed results (never hand-authored) to
 * `mod/golden-fixtures/version.json`. Both the TS reference and the C# port
 * (`Sitrep.Core.Tests`) are checked against this same file — it is the
 * shared cross-language contract for `compareVersions` / `satisfiesKernel` /
 * `satisfiesModRange`.
 *
 * Run with: `pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures`
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  satisfiesKernel,
  satisfiesModRange,
  type VersionRange,
} from "../../sitrep-kernel/src/version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "version.json");

type CompareVersionsVector = {
  fn: "compareVersions";
  args: [a: string, b: string];
  expected: number;
};

type SatisfiesKernelVector = {
  fn: "satisfiesKernel";
  args: [kernelVersion: string, minKernelVersion: string | null];
  expected: boolean;
};

type SatisfiesModRangeVector = {
  fn: "satisfiesModRange";
  args: [modVersion: string | null, range: VersionRange | null];
  expected: boolean;
};

type Vector =
  | CompareVersionsVector
  | SatisfiesKernelVector
  | SatisfiesModRangeVector;

const compareVersionsCases: Array<[string, string]> = [
  // Numeric-not-lexical: "1.2" < "1.10" as numbers, but ">" lexically.
  ["1.2.0", "1.10.0"],
  ["1.10.0", "1.2.0"],
  ["1.2.9", "1.10.0"],
  // Equal versions.
  ["1.2.3", "1.2.3"],
  ["0.0.0", "0.0.0"],
  // Greater on major/minor/patch individually.
  ["2.0.0", "1.9.9"],
  ["1.3.0", "1.2.9"],
  ["1.2.4", "1.2.3"],
  // Missing trailing components treated as 0 (short-form versions).
  ["1.2", "1.2.0"],
  ["1", "1.0.0"],
  ["1.2", "1.3.0"],
  ["1.2.0", "1.2"],
  ["2", "1.999.999"],
];

const satisfiesKernelCases: Array<[string, string | null]> = [
  ["1.5.0", "1.2.0"], // above minimum
  ["1.0.0", "1.2.0"], // below minimum
  ["1.2.0", "1.2.0"], // equal to minimum (inclusive)
  ["1.2.0", null], // no minimum constraint
  ["1.2", "1.2.0"], // short-form kernel version, equal
  ["1.1.9", "1.2"], // short-form minimum
];

const satisfiesModRangeCases: Array<[string | null, VersionRange | null]> = [
  ["1.5.0", { min: "1.0.0", max: "2.0.0" }], // within range
  ["1.0.0", { min: "1.0.0", max: "2.0.0" }], // min boundary, inclusive -> true
  ["2.0.0", { min: "1.0.0", max: "2.0.0" }], // max boundary, exclusive -> false
  ["1.999.999", { min: "1.0.0", max: "2.0.0" }], // just under exclusive max
  ["999.0.0", { min: "1.0.0" }], // open-ended max
  ["1.0.0", { min: "1.0.0" }], // open-ended max, min boundary
  ["0.9.0", { min: "1.0.0", max: "2.0.0" }], // below min
  ["1.5.0", null], // no range constraint
  [null, { min: "1.0.0" }], // undefined modVersion, defined range -> false
  [null, null], // undefined modVersion, undefined range -> true
  ["1.2", { min: "1.2.0", max: "1.3.0" }], // short-form modVersion
];

function toUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

const vectors: Vector[] = [
  ...compareVersionsCases.map(
    ([a, b]): CompareVersionsVector => ({
      fn: "compareVersions",
      args: [a, b],
      expected: compareVersions(a, b),
    }),
  ),
  ...satisfiesKernelCases.map(
    ([kernelVersion, minKernelVersion]): SatisfiesKernelVector => ({
      fn: "satisfiesKernel",
      args: [kernelVersion, minKernelVersion],
      expected: satisfiesKernel(kernelVersion, toUndefined(minKernelVersion)),
    }),
  ),
  ...satisfiesModRangeCases.map(
    ([modVersion, range]): SatisfiesModRangeVector => ({
      fn: "satisfiesModRange",
      args: [modVersion, range],
      expected: satisfiesModRange(toUndefined(modVersion), toUndefined(range)),
    }),
  ),
];

writeFileSync(OUT_FILE, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`golden-fixtures -> ${OUT_FILE} (${vectors.length} vectors)`);
