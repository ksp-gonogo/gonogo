import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  claimants,
  classWeights,
  partition,
} from "../../../scripts/integration-shard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHARDS = 5;

describe("the integration suite's CI shards", () => {
  const weights: Map<string, number> = classWeights();
  const shards: string[][] = partition(weights, SHARDS);

  it("reads the project's classes at all, before checking the split", () => {
    expect(weights.size).toBeGreaterThan(50);
    expect(weights.has("ChannelEngineTests")).toBe(true);
  });

  it("puts every test class in exactly one shard", () => {
    for (const name of weights.keys()) {
      const hits = claimants(
        `Sitrep.Host.IntegrationTests.${name}.SomeTest`,
        shards,
      );
      expect(hits, name).toHaveLength(1);
    }
  });

  it("sees a class dropped from every shard", () => {
    const dropped = shards.map((s) =>
      s.filter((c) => c !== "ChannelEngineTests"),
    );
    expect(
      claimants("Sitrep.Host.IntegrationTests.ChannelEngineTests.X", dropped),
    ).toEqual([]);
  });

  it("keeps the busiest shard near an even share", () => {
    const load = shards.map((s) =>
      s.reduce((sum, c) => sum + (weights.get(c) ?? 0), 0),
    );
    const mean = load.reduce((a, b) => a + b, 0) / SHARDS;
    expect(Math.max(...load)).toBeLessThan(mean * 1.25);
  });

  it("is run by a ci.yml job whose matrix is the shard count", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain(
      `name: mod-integration (\${{ matrix.shard }}/${SHARDS})`,
    );
    expect(ci).toContain(
      `shard: [${Array.from({ length: SHARDS }, (_, i) => i + 1).join(", ")}]`,
    );
    expect(ci).toContain(`integration-shard.mjs verify ${SHARDS}`);
    expect(ci).toContain(
      `integration-shard.mjs" filter \${{ matrix.shard }}/${SHARDS}`,
    );
  });
});
