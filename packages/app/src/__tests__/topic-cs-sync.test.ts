import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllKnownTopicIds } from "@ksp-gonogo/sitrep-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import {
  firstPartyUplinkClientRelDirs,
  importFirstPartyUplinkClients,
  trackedUplinkClientDirs,
} from "../test/firstPartyUplinkIds";
import { PLANTED_TOPIC } from "../test/plantedUplinkClient";

// packages/app/src/__tests__ -> repo root -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "mod",
);

/**
 * Recursively collect production C# sources (skip build output, test projects, the example
 * skeleton server). Mirrors the collector the SDK's own `topics.test.ts` used before this
 * bidirectional check moved here: the SDK package cannot import the Uplink clients (that
 * would be the `^build` cycle the leaf architecture forbids), so the FULL C#↔registry sync
 * check lives here in `packages/app`, downstream of the Uplink clients, where the complete
 * registered union actually exists.
 */
function collectContractSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (
        entry === "obj" ||
        entry === "bin" ||
        entry === "node_modules" ||
        entry === "dist" ||
        entry.includes("Tests") || // *.Tests / *.IntegrationTests
        // Test scaffolding, `IsPackable=false`, never shipped and never
        // registered at runtime. Its probe declares a Topic constant so a seam
        // can be driven from an Uplink's exact compile surface, and holding a
        // test double to the shipped-registry rule would force it to either
        // name a real Topic or stop looking like one.
        entry === "Sitrep.Contract.TestSupport" ||
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
 * The planted Uplink tree the C# Uplink walks read. Its `Tests`-named
 * parent keeps it out of {@link MOD_ROOT}'s scan, so it is read on purpose and
 * only here, as the C# half of the pair `plantedUplinkClient.ts` registers.
 */
const PLANT_ROOT = join(MOD_ROOT, "Sitrep.Core.Tests", "UplinkWalkPlant");

/**
 * Every declared channel Topic in the C# sources: `const string <Name>Topic = "<value>"`.
 * Dotted values only: drops the kOS parser's dot-less "default" fallback bucket (and never
 * matches the `kos.compute.` dynamic *prefix*, whose constant is `ComputePrefix`).
 */
function extractDeclaredTopics(root: string): Set<string> {
  const re = /const\s+string\s+\w*Topic\w*\s*=\s*"([^"]+)"/g;
  const topics = new Set<string>();
  for (const file of collectContractSources(root)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const value = m[1];
      if (value.includes(".")) topics.add(value);
    }
  }
  return topics;
}

/** Both directions of the sync, sorted: what C# declares that nothing knows, and the reverse. */
function syncDiff(
  declared: ReadonlySet<string>,
  known: ReadonlySet<string>,
): { missingFromRegistry: string[]; staleInRegistry: string[] } {
  return {
    missingFromRegistry: [...declared].filter((t) => !known.has(t)).sort(),
    staleInRegistry: [...known].filter((t) => !declared.has(t)).sort(),
  };
}

describe("C#-declared Topics stay in exact sync with the full runtime registry", () => {
  /**
   * Every first-party Uplink client present runs its `registerBarePrimitiveTopic(...)`
   * calls, so by the time the assertions read `getAllKnownTopicIds()` the runtime registry
   * holds the SDK's own Topics plus every bare-primitive Uplink Topic. Discovered rather
   * than imported by name, because each mod Uplink is leaving for its own repo and a named
   * import fails to resolve the moment one does.
   */
  beforeAll(async () => {
    await importFirstPartyUplinkClients();
  }, 30_000);

  const declared = () =>
    new Set([
      ...extractDeclaredTopics(MOD_ROOT),
      ...extractDeclaredTopics(PLANT_ROOT),
    ]);
  const known = () => new Set<string>(getAllKnownTopicIds());

  it("imports every Uplink client git tracks", () => {
    expect(firstPartyUplinkClientRelDirs()).toEqual(trackedUplinkClientDirs());
  });

  /**
   * A scan budget rather than a unit-test budget. This walks every `.cs` file in
   * `mod/` with synchronous reads, and its cost is dominated by how busy the
   * machine is, NOT by how much it has to scan.
   *
   * Measured, all on a 14-core box under six concurrent agents:
   *
   *     load 14.40   tests 481ms
   *     load 13.93   tests 935ms
   *     load 14.16   tests 786ms
   *     load 13.53   tests 704ms
   *
   * and the same body has also been observed past 5s under heavier load. So the
   * spread is better than 10x, and the VARIANCE is the finding rather than any
   * one figure: a 5s default is simply the wrong instrument for a whole-tree
   * scan sharing a machine.
   *
   * An earlier version of this comment claimed ~4.0s and reasoned that the gate
   * was near its limit as the C# tree grew. That was one sample of a variable
   * quantity quoted as a property of the code, and it is wrong: adding files
   * barely moves this. Recorded because the wrong version would have had the
   * next reader either narrow the scan or distrust a green.
   *
   * Raised rather than narrowed on purpose. The scan being exhaustive is the
   * whole point of the gate (a Topic declared in C# and unknown to the registry
   * is exactly what it catches), so trading coverage for speed would be paying
   * in the wrong currency.
   */
  it("every C# Topic is known, and every known Topic is declared in C#", () => {
    const { missingFromRegistry, staleInRegistry } = syncDiff(
      declared(),
      known(),
    );

    // missingFromRegistry: a Topic declared in C# that no client registers and the SDK
    // does not own, either a new bare-primitive Topic whose client forgot its
    // `registerBarePrimitiveTopic`, or a generated/engine Topic missing from the SDK.
    expect(
      missingFromRegistry,
      "C# Topics not known to the runtime registry",
    ).toEqual([]);
    // staleInRegistry: a registered/SDK Topic with no matching C# declaration, a stale
    // registration or a renamed/removed C# Topic.
    expect(
      staleInRegistry,
      "runtime-registry Topics no longer declared in C#",
    ).toEqual([]);
  }, 30_000);

  /**
   * The witness that the scan and the registration both reach a real pair.
   * Naming a real Uplink's Topic would tie this repo to that Uplink still
   * existing, so a planted pair is used instead: read out of the planted C#
   * tree and registered by the planted client.
   */
  it("reads the planted Uplink's C# Topic and sees its client registration", () => {
    expect(extractDeclaredTopics(PLANT_ROOT)).toContain(PLANTED_TOPIC);
    expect(known()).toContain(PLANTED_TOPIC);
  });

  /**
   * Each direction fails on a one-sided plant, so an empty diff above is the sync holding
   * rather than a comparison that cannot see a gap.
   */
  it("reports the planted Topic when either side of the pair is missing", () => {
    const withoutRegistration = new Set(known());
    withoutRegistration.delete(PLANTED_TOPIC);
    expect(
      syncDiff(declared(), withoutRegistration).missingFromRegistry,
    ).toEqual([PLANTED_TOPIC]);

    const withoutDeclaration = new Set(declared());
    withoutDeclaration.delete(PLANTED_TOPIC);
    expect(syncDiff(withoutDeclaration, known()).staleInRegistry).toEqual([
      PLANTED_TOPIC,
    ]);
  });
});
