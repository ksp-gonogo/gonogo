import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cross-boundary contract test for the SCANsat unified fix
 * (`local_docs/scansat-unified-fix-plan.md`, Task 4). The dynamic
 * per-(body,type) namespaces must be described by the SAME canonical prefix
 * strings on both sides of the wire, or a future namespace silently desyncs
 * (the mod publishes under one string while the client carries/resolves
 * another — exactly the class of break this whole fix addresses).
 *
 * This locks the MOD side to the canonical list now, and documents the
 * client-side cross-check to enable the moment the client fix exports its
 * shared prefix list (unified plan Tasks 1+2 introduce
 * `DYNAMIC_CARRIED_TOPIC_PREFIXES` in `@ksp-gonogo/sitrep-client`'s
 * `default-carried-topics.ts`).
 */

// The single source of truth for the plan. These are the dynamic-namespace
// whole-topic prefixes (trailing `.`) the whole pipeline must agree on.
const CANONICAL_DYNAMIC_PREFIXES = [
  "scansat.coverage.",
  "scansat.mask.",
  "scansat.height.",
  "scansat.biome.",
  "scansat.anomalies.",
] as const;

function readModPrefixes(): string[] {
  // vitest runs this package's tests with cwd = the client package dir
  // (mod/GonogoScansatUplink/client), so the mod source is one level up.
  const source = readFileSync(
    resolve(process.cwd(), "../ScanChannels.cs"),
    "utf8",
  );
  const prefixes: string[] = [];
  for (const match of source.matchAll(/\w+Prefix\s*=\s*"([^"]+)"/g)) {
    prefixes.push(match[1]);
  }
  return prefixes;
}

describe("SCANsat dynamic-topic prefix contract", () => {
  it("the mod's ScanChannels.*Prefix constants are exactly the canonical list", () => {
    const modPrefixes = readModPrefixes();
    // Set-equality (order-independent): every canonical prefix is declared by
    // the mod, and the mod declares no extra dynamic prefix the plan doesn't
    // know about.
    expect([...modPrefixes].sort()).toEqual(
      [...CANONICAL_DYNAMIC_PREFIXES].sort(),
    );
  });

  it("every canonical prefix is a 3-segment `scansat.<channel>.` shape (trailing dot, no body/type baked in)", () => {
    for (const prefix of CANONICAL_DYNAMIC_PREFIXES) {
      expect(prefix.startsWith("scansat.")).toBe(true);
      expect(prefix.endsWith(".")).toBe(true);
      // domain + channel + trailing empty segment => 3 parts on split.
      expect(prefix.split(".").filter((s) => s.length > 0)).toHaveLength(2);
    }
  });

  // GREEN when unified-plan Tasks 1+2 land: assert the client's shared prefix
  // list equals the canonical list (and hence the mod's), so the carried-gate
  // (Bug A) and TimelineStore resolution (Bug B) can never drift from what the
  // mod publishes. Enable by importing `DYNAMIC_CARRIED_TOPIC_PREFIXES` from
  // `@ksp-gonogo/sitrep-client` and asserting `.sort()` deep-equals
  // `CANONICAL_DYNAMIC_PREFIXES.sort()`.
  it.todo(
    "client DYNAMIC_CARRIED_TOPIC_PREFIXES equals the canonical mod prefixes",
  );
});
