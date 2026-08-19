import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";
import {
  getAllKnownTopicIds,
  isTopicId,
  registerBarePrimitiveTopic,
  TOPIC_IDS,
  type TopicPayload,
  type TopicPayloadMap,
} from "./topics";

/**
 * The Topics declared by hand in topics.ts (not reflected out of a `[SitrepTopic]`
 * contract type): the two ENGINE-AGGREGATED system channels. See the topics.ts header.
 * Everything else in `TOPIC_IDS` MUST come from the generated map. The bare-primitive
 * Uplink Topics are NO LONGER here: they moved out to their owning Uplink client packages
 * (each registers its id at load via `registerBarePrimitiveTopic`), so they are not part of
 * the SDK's own `TOPIC_IDS`.
 */
const HAND_DECLARED_TOPICS = [
  "system.uplinks",
  "system.uplink.pending",
  // The contract's own unit descriptor, so the stream describes itself. Same
  // engine-declared treatment as the two above: ChannelEngine sources it
  // directly because it describes the CONTRACT rather than anything an
  // uplink owns, so it carries no [SitrepTopic] to reflect.
  "system.units",
];

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
        // Build output, and 43% of everything under mod/ once the spine landed
        // in the sdk. It cannot contain a `.cs` file, so walking it is pure cost:
        // enough of it to push this test's 5s budget over on a parallel run.
        entry === "dist" ||
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
 * <Name>Topic = "<value>"`. Dotted values only: this drops the kOS parser's
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
  it("every SDK-owned Topic is declared in C# (forward self-check)", () => {
    // NARROWED (2026-07-20): this SDK package cannot see the Uplink client
    // packages that own the bare-primitive Topics: importing them here would be
    // the very `^build` cycle the leaf architecture forbids, so the SDK's own
    // registry (`TOPIC_IDS`) legitimately does NOT contain them. The FULL
    // bidirectional C#↔registry sync check (which needs the union of every
    // registered bare-primitive Topic) therefore lives in `packages/app`,
    // downstream of all Uplink clients: `topic-cs-sync.test.ts`. Here we keep only
    // the forward half: every Topic the SDK itself owns must be declared in C#.
    const declared = extractDeclaredTopics();
    const staleInSdk = [...TOPIC_IDS].filter((t) => !declared.has(t)).sort();

    // If this fails: an SDK-owned Topic (generated or the engine tail) is no
    // longer declared in C#: regenerate the codegen map / fix the engine tail.
    expect(staleInSdk, "SDK-owned Topics no longer declared in C#").toEqual([]);
    // The 30s budget is for `extractDeclaredTopics`, which walks and reads every
    // production `.cs` file under `mod/`, not for the assertion. Same measurement
    // and same reasoning as `control-channels-cs-sync.test.ts`: ~250ms alone,
    // seconds inside a full parallel `pnpm test`, so the default 5s failed as a
    // timeout on the whole-repo run while passing in isolation.
  }, 30_000);

  it("has no duplicate TopicIds", () => {
    expect(new Set(TOPIC_IDS).size).toBe(TOPIC_IDS.length);
  });

  // avionics.status no longer appears in GENERATED_TOPIC_IDS: AvionicsStatus
  // relocated out of Sitrep.Contract into GonogoAvionicsUplink.Contract
  // (uplink-types-out-of-core plan), so it is no longer this SDK's own
  // codegen output. It is now a bare-registered Uplink Topic, same shape as
  // avionics.available: see mod/GonogoAvionicsUplink/client/src/topics.ts.

  it("is driven by the generated (codegen) map, not a hand-authored one", () => {
    // The registry must be exactly the generated ids plus the documented hand tail,
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

  it("system.uplinks roster entries carry the optional expectedClientHash (mod-hash arm)", () => {
    type Entry = TopicPayload<"system.uplinks">["uplinks"][number];
    expectTypeOf<Entry["expectedClientHash"]>().toEqualTypeOf<string | null>();
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

  describe("registerBarePrimitiveTopic", () => {
    // A synthetic id (not a real Uplink Topic) keeps the module-global registry
    // uncontaminated for the rest of the suite, the real bare topics are
    // registered by their own Uplink client packages, never by the SDK.
    const SYNTHETIC = "test.synthetic.bare";

    it("makes a registered bare Topic pass isTopicId and appear in getAllKnownTopicIds", () => {
      expect(isTopicId(SYNTHETIC)).toBe(false);
      expect(getAllKnownTopicIds()).not.toContain(SYNTHETIC);

      registerBarePrimitiveTopic(SYNTHETIC);

      expect(isTopicId(SYNTHETIC)).toBe(true);
      expect(getAllKnownTopicIds()).toContain(SYNTHETIC);
    });

    it("is idempotent, a double register adds no duplicate", () => {
      registerBarePrimitiveTopic(SYNTHETIC);
      registerBarePrimitiveTopic(SYNTHETIC);
      const all = getAllKnownTopicIds();
      expect(all.filter((t) => t === SYNTHETIC)).toHaveLength(1);
    });

    it("getAllKnownTopicIds contains every SDK-owned TOPIC_IDS entry", () => {
      const all = new Set(getAllKnownTopicIds());
      for (const id of TOPIC_IDS) expect(all.has(id)).toBe(true);
    });
  });

  // The kerbalism.* half of this block moved out with its payload types
  // (uplink-types-out-of-core plan): those five Topics are no longer this
  // assembly's codegen output, so asserting them here would be asserting
  // something core is deliberately no longer responsible for. Their
  // "codegen emits this Topic id" proof lives in the owning Uplink's own
  // topics.test.ts, alongside the C#-constant cross-check that this leaf could
  // never do. reliability.* stays: it is a DOMAIN-NEUTRAL capability channel
  // (see Reliability.cs), served by whichever backend wins election, so it is
  // core's own contract and not any one mod's.
  describe("reliability capability topics", () => {
    it("codegen emits every reliability.* topic id", () => {
      for (const id of ["reliability.summary", "reliability.parts"]) {
        expect(GENERATED_TOPIC_IDS).toContain(id);
      }
    });
  });
});
