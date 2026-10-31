import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerUnit, resetUnitRegistry } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { unresolvedUnitTokens } from "./unit-tokens";

const dirs: string[] = [];

function unitsFile(types: Record<string, Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "unit-tokens-"));
  dirs.push(dir);
  const path = join(dir, "units.json");
  writeFileSync(path, JSON.stringify({ types, topics: {} }));
  return path;
}

afterEach(() => {
  resetUnitRegistry();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("a units.json token must resolve to a unit", () => {
  it("accepts the sdk's own units and the tokens that are not quantities", () => {
    const path = unitsFile({
      Flight: { altitude: "m", speed: "m/s", landed: "flag", name: "text" },
    });
    expect(unresolvedUnitTokens(path)).toEqual([]);
  });

  it("reports a token nothing registers, and a compound of unregistered parts", () => {
    const path = unitsFile({
      Planted: { a: "zz-unregistered", b: "science/MB", c: "m" },
    });
    expect(unresolvedUnitTokens(path)).toEqual([
      "science/MB",
      "zz-unregistered",
    ]);
  });

  it("accepts a token the client registers", () => {
    registerUnit({
      symbol: "zz-registered",
      kind: "zz",
      dimension: { zz: 1 },
      ratio: 1,
    } as never);
    const path = unitsFile({ Planted: { a: "zz-registered" } });
    expect(unresolvedUnitTokens(path)).toEqual([]);
  });

  it("reports nothing for an Uplink with no units.json", () => {
    expect(unresolvedUnitTokens(join(tmpdir(), "no-such-units.json"))).toEqual(
      [],
    );
  });
});
