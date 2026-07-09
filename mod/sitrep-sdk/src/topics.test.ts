import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTopicId, TOPIC_IDS, type TopicPayloadMap } from "./topics";

// mod/sitrep-sdk/src -> mod
const MOD_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Recursively collect production C# sources (skip build output, tests, skeleton). */
function collectContractSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (
        entry === "obj" ||
        entry === "bin" ||
        entry === "node_modules" ||
        entry.includes("Tests") || // *.Tests / *.IntegrationTests
        entry === "Sitrep.Skeleton" // example server, not a shipped Uplink
      ) {
        continue;
      }
      collectContractSources(full, out);
    } else if (entry.endsWith(".cs")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract every declared channel Topic from the C# sources: `const string
 * <Name>Topic = "<value>"`. Dotted values only — this drops the kOS parser's
 * dot-less "default" fallback bucket (and never matches the `kos.compute.` dynamic
 * *prefix*, whose constant is `ComputePrefix`, not `...Topic`).
 */
function extractDeclaredTopics(): Set<string> {
  const re = /const\s+string\s+\w*Topic\w*\s*=\s*"([^"]+)"/g;
  const topics = new Set<string>();
  for (const file of collectContractSources(MOD_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const value = m[1];
      if (value.includes(".")) topics.add(value);
    }
  }
  return topics;
}

describe("typed Topic registry", () => {
  it("stays in exact sync with the C# ChannelDeclaration Topics", () => {
    const declared = extractDeclaredTopics();
    const registry = new Set<string>(TOPIC_IDS);

    const missingFromSdk = [...declared].filter((t) => !registry.has(t)).sort();
    const staleInSdk = [...registry].filter((t) => !declared.has(t)).sort();

    // If these fail: a Topic was added/removed in C# — update src/topics.ts to match.
    expect(
      missingFromSdk,
      "Topics declared in C# but missing from the SDK",
    ).toEqual([]);
    expect(
      staleInSdk,
      "Topics in the SDK but no longer declared in C#",
    ).toEqual([]);
  });

  it("has no duplicate TopicIds", () => {
    expect(new Set(TOPIC_IDS).size).toBe(TOPIC_IDS.length);
  });

  it("TopicPayloadMap and TOPIC_IDS enumerate the same Topics", () => {
    // A runtime witness of the compile-time bind in topics.ts. `keyof` isn't available
    // at runtime, so we assert the array is non-trivial and self-consistent; the
    // exhaustive key/array equality is enforced statically by _AssertNo(Missing|Extra)Topics.
    const witness: Record<keyof TopicPayloadMap, true> = Object.fromEntries(
      TOPIC_IDS.map((t) => [t, true]),
    ) as Record<keyof TopicPayloadMap, true>;
    expect(Object.keys(witness).length).toBe(TOPIC_IDS.length);
  });

  describe("isTopicId", () => {
    it("accepts a declared Topic", () => {
      expect(isTopicId("vessel.orbit")).toBe(true);
      expect(isTopicId("comms.delay")).toBe(true);
    });
    it("rejects an unknown string", () => {
      expect(isTopicId("vessel.nope")).toBe(false);
      expect(isTopicId("")).toBe(false);
      expect(isTopicId("kos.compute.1.foo")).toBe(false); // dynamic sub-topic, not enumerated
    });
  });
});
