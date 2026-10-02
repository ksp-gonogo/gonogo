import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXTERNAL_IDENTIFIERS } from "./dead-identifiers.allowlist";
import { codeWords, deadIdentifiers } from "./dead-identifiers.scan";
import type { SourceFile } from "./stale-references.scan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TRACKED = execFileSync("git", ["ls-files"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 27,
})
  .split("\n")
  .filter(Boolean);

const read = (path: string): SourceFile => ({
  path,
  text: readFileSync(join(ROOT, path), "utf8"),
});

const IN_TREE = /^(packages|mod|scripts)\//;
const NOT_BUILT = /\/(dist|node_modules)\//;

const EXISTING = TRACKED.filter(
  (f) => IN_TREE.test(f) && /\.(tsx?|mjs|js|cs)$/.test(f) && !NOT_BUILT.test(f),
).map(read);

const GRADED = EXISTING.filter(
  (f) =>
    !/\.cs$/.test(f.path) &&
    !/\.test(-d)?\.tsx?$/.test(f.path) &&
    !/\/__generated__\//.test(f.path) &&
    !/\/(storybook|test-utils)\//.test(f.path),
);

/**
 * This file is left out of the names that exist: it spells the planted names
 * below, and a name the plant spells must not count as present.
 */
const SELF = "packages/core/src/styleguide-dead-identifiers.test.ts";
const EXISTS = new Set<string>();
for (const file of EXISTING)
  if (file.path !== SELF) for (const w of codeWords(file)) EXISTS.add(w);

describe("comments name only symbols the tree has", () => {
  it("reads the tree, so a clean answer means it looked", () => {
    expect(GRADED.length).toBeGreaterThan(1000);
    expect(EXISTS.size).toBeGreaterThan(20000);
    expect(EXISTS.has("deadIdentifiers")).toBe(true);
    expect(EXISTS.has("SitrepTelemetryProvider")).toBe(true);
  });

  it("puts no symbol of our own in code format that nothing spells", () => {
    const dead = deadIdentifiers(GRADED, EXISTS, EXTERNAL_IDENTIFIERS)
      .map((d) => `${d.file} -> ${d.symbol}`)
      .sort();
    expect(
      dead,
      `These comments put a name in code format that no source spells, so a reader searching for it finds nothing. Rename it to what exists or drop the code format. A platform or dependency name goes in dead-identifiers.allowlist.ts, one of ours never does:\n  ${dead.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the dead-identifier scan sees what it is meant to", () => {
  const PLANTED: SourceFile = {
    path: "packages/ui-kit/src/planted.ts",
    text: [
      "/** Draws the mark through `plantedGoneHelper` and `PlantedGoneType()`. */",
      "// Reads `deadIdentifiers`, which exists, and `abc`, which is too short to grade.",
      "// `plantedExternalName` belongs to the platform.",
      'const s = "`plantedInString` is a string, not a comment";',
    ].join("\n"),
  };

  const found = deadIdentifiers(
    [...GRADED, PLANTED],
    new Set([...EXISTS, ...codeWords(PLANTED)]),
    new Set(["plantedExternalName"]),
  ).filter((d) => d.file === PLANTED.path);

  it("finds a missing symbol, called or not, in a doc comment", () => {
    expect(found.map((d) => d.symbol).sort()).toEqual([
      "PlantedGoneType",
      "plantedGoneHelper",
    ]);
  });

  it("passes a name that exists, a short one, an external one, and a string", () => {
    const names = found.map((d) => d.symbol);
    for (const ok of [
      "deadIdentifiers",
      "abc",
      "plantedExternalName",
      "plantedInString",
    ])
      expect(names).not.toContain(ok);
  });
});
