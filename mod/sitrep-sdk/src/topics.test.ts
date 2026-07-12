import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";
import { isTopicId, TOPIC_IDS, type TopicPayloadMap } from "./topics";

/**
 * The Topics declared by hand in topics.ts (not reflected out of a `[SitrepTopic]`
 * contract type) — a bare JSON boolean. See the topics.ts header. Everything else in
 * the registry MUST come from the generated map.
 */
const HAND_DECLARED_TOPICS = ["scansat.available"];

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

  it("is driven by the generated (codegen) map, not a hand-authored one", () => {
    // The registry must be exactly the generated ids plus the documented hand tail —
    // proving the map really comes from codegen (a stale/hand-maintained map would
    // drift from GENERATED_TOPIC_IDS). Paired with the compile-time
    // `_AssertNoTopicResolvesToUnknown` in topics.ts + the `_NoTopicIsUnknown` proof
    // in topics.test-d.ts, this is the runtime half of "no Topic resolves to unknown".
    expect(GENERATED_TOPIC_IDS.length).toBeGreaterThan(0);
    for (const id of GENERATED_TOPIC_IDS) {
      expect(TOPIC_IDS).toContain(id);
    }
    const nonGenerated = TOPIC_IDS.filter(
      (t) => !(GENERATED_TOPIC_IDS as readonly string[]).includes(t),
    ).sort();
    expect(nonGenerated).toEqual([...HAND_DECLARED_TOPICS].sort());
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
