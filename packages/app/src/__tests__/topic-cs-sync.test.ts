import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Static, side-effecting imports of every first-party Uplink client. Importing each
// package runs its `registerBarePrimitiveTopic(...)` calls, so by the time the assertions
// read `getAllKnownTopicIds()` the runtime registry holds the full union, the SDK's own
// Topics PLUS every bare-primitive Uplink Topic. These imports are DELIBERATE and must stay
// static (not the app's possibly-dynamic runtime load path) so the test is deterministic.
import "@ksp-gonogo/gonogo-kerbalism-uplink";
import "@ksp-gonogo/gonogo-avionics-uplink";
import "@ksp-gonogo/gonogo-kerbcast-uplink";
import "@ksp-gonogo/gonogo-kos-uplink";
import "@ksp-gonogo/gonogo-scansat-uplink";
import "@ksp-gonogo/gonogo-realantennas-uplink";
import { getAllKnownTopicIds } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";

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
 * check lives here in `packages/app`, downstream of all three Uplink clients, where the
 * complete registered union actually exists.
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
 * Every declared channel Topic in the C# sources: `const string <Name>Topic = "<value>"`.
 * Dotted values only: drops the kOS parser's dot-less "default" fallback bucket (and never
 * matches the `kos.compute.` dynamic *prefix*, whose constant is `ComputePrefix`).
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

describe("C#-declared Topics stay in exact sync with the full runtime registry", () => {
  /**
   * The timeout is raised because this test's cost grows with the C# tree, not
   * with anything it asserts. It walks every `.cs` file in `mod/` and was
   * sitting at ~4.0s against vitest's 5s default, so roughly one second of
   * headroom for a repo that gains C# files most days: adding three unrelated
   * ones tipped it over, which is a scheduling accident rather than a
   * regression in what it checks.
   *
   * Raised rather than narrowed on purpose. The scan being exhaustive is the
   * whole point of the gate (a Topic declared in C# and unknown to the registry
   * is exactly what it catches), so trading coverage for speed would be paying
   * in the wrong currency. If it approaches this bound too, cache the file walk
   * rather than scoping it down.
   */
  it("every C# Topic is known, and every known Topic is declared in C#", () => {
    const declared = extractDeclaredTopics();
    const known = new Set<string>(getAllKnownTopicIds());

    const missingFromRegistry = [...declared]
      .filter((t) => !known.has(t))
      .sort();
    const staleInRegistry = [...known].filter((t) => !declared.has(t)).sort();

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

  it("the bare-primitive Uplink Topics are present via client registration", () => {
    // A focused witness that the relocation's whole point holds: these are NOT in the
    // SDK's static TOPIC_IDS, so their presence proves the client imports above fired their
    // registration.
    const known = new Set<string>(getAllKnownTopicIds());
    expect(known.has("scansat.available")).toBe(true);
    expect(known.has("kerbcast.available")).toBe(true);
    expect(known.has("kerbalism.available")).toBe(true);
    expect(known.has("avionics.available")).toBe(true);
  });
});
