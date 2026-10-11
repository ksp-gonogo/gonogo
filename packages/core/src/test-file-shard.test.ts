import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listTestFiles,
  measuredWeights,
  partitionFiles,
} from "../../../scripts/test-file-shard.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SHARDS = 3;

describe("the weighted test file shards", () => {
  const weights: Record<string, number> = measuredWeights();
  const files: string[] = listTestFiles(join(ROOT, "packages", "components"));
  const shards: string[][] = partitionFiles(files, weights, SHARDS);

  it("reads the package's files at all, before checking the split", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("puts every test file in exactly one shard", () => {
    expect(shards.flat().sort()).toEqual([...files].sort());
  });

  it("keeps the heaviest shard near an even share", () => {
    const load = shards.map((s) =>
      s.reduce((sum, f) => sum + (weights[f.slice(ROOT.length + 1)] ?? 1), 0),
    );
    const mean = load.reduce((a, b) => a + b, 0) / SHARDS;
    expect(Math.max(...load)).toBeLessThan(mean * 1.2);
  });

  it("splits the same way twice", () => {
    expect(partitionFiles(files, weights, SHARDS)).toEqual(shards);
  });
});
