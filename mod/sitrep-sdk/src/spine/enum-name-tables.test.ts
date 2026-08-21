import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ControlState,
  Situation,
  TargetKind,
  TransitionType,
} from "../__generated__/contract";
import { TRANSITION_TYPE_NAMES } from "./orbit-patches";
import { HEALTH_STATE_NAMES } from "./uplink-health";
import { CONTROL_STATE_LEVEL, ENUM_NAME_TABLES } from "./vessel-state";

/**
 * An ordinal→name table has to cover its enum, entry for entry.
 *
 * The wire carries a C# enum as its ORDINAL, and these tables are what turns
 * one back into a name. A table shorter than its enum does not throw and does
 * not warn: the ordinal indexes off the end, the lookup yields `undefined`, and
 * every consumer reads that as "nothing arrived". It fails in the direction
 * where everything looks fine, and it fails at the moment somebody appends an
 * enum member, which is exactly when nobody re-reads the tables.
 *
 * That is not hypothetical. `TARGET_KIND_NAMES` carried three entries for a
 * five-member `TargetKind` for as long as `Position` and `Part` have existed,
 * so a docking-port target published no kind at all.
 *
 * The tables are now derived from the generated enums rather than transcribed
 * beside them, which is what actually removes the drift. This file is the check
 * on that: it fails if any table is rebuilt by hand, and it covers the two
 * tables that CANNOT be derived, because they carry their own casing, plus
 * `CONTROL_STATE_LEVEL`, which is a hand-written verdict per ordinal.
 */

/** Ordinal→name pairs a generated numeric enum declares, in ordinal order. */
function declaredNames(members: object): string[] {
  return Object.entries(members)
    .filter(([key]) => Number.isInteger(Number(key)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, name]) => String(name));
}

// mod/sitrep-sdk/src/spine -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Members of a C# enum, read out of the contract source.
 *
 * The route for an enum the codegen does not emit into TypeScript. Those are
 * the ones most at risk: a TS-side table mirroring them has no compiler, no
 * generated twin, and nothing but a comment tying it to the declaration.
 */
function csharpEnumMembers(relativePath: string, enumName: string): string[] {
  const source = readFileSync(join(MOD_ROOT, relativePath), "utf8");
  const body = new RegExp(`\\benum\\s+${enumName}\\b[^{]*\\{([^}]*)\\}`).exec(
    source,
  )?.[1];
  if (body === undefined) {
    throw new Error(`no enum ${enumName} in ${relativePath}`);
  }
  return body
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/.*$/, "")
        .trim()
        .replace(/,$/, ""),
    )
    .filter((line) => /^[A-Za-z_]\w*$/.test(line));
}

describe("enum name tables cover their enums", () => {
  // Guards the guard. Every assertion below is a comparison against
  // `declaredNames`, so a `declaredNames` that silently returned nothing would
  // make an empty table pass and report success. See CLAUDE.md on instruments
  // blind to their own failure mode.
  it("can read the members off a generated enum at all", () => {
    expect(declaredNames(Situation)).toEqual([
      "Landed",
      "Splashed",
      "PreLaunch",
      "Orbiting",
      "Escaping",
      "Flying",
      "SubOrbital",
      "Docked",
      "Unknown",
    ]);
  });

  for (const { label, members, names } of ENUM_NAME_TABLES) {
    it(`${label} matches its enum`, () => {
      expect(names).toEqual(declaredNames(members));
    });
  }

  it("has a table registered for every enum vessel-state resolves a name for", () => {
    expect(ENUM_NAME_TABLES.map((t) => t.label).sort()).toEqual([
      "CONTROL_STATE_NAMES",
      "SAS_MODE_NAMES",
      "SITUATION_NAMES",
      "TARGET_KIND_NAMES",
    ]);
  });

  /**
   * Uppercased rather than derived verbatim: this table publishes the legacy
   * spelling the ground-track consumers were written against.
   */
  it("TRANSITION_TYPE_NAMES matches TransitionType, uppercased", () => {
    expect(TRANSITION_TYPE_NAMES).toEqual(
      declaredNames(TransitionType).map((n) => n.toUpperCase()),
    );
  });

  /**
   * Lowercased, and deliberately still hand-written: its literal tuple type is
   * what gives `UplinkHealthStateName` a closed union for callers to key a
   * `Record` on. That makes it the one table a member can still be appended to
   * without, so it is asserted here instead.
   */
  it("HEALTH_STATE_NAMES matches UplinkHealthState, lowercased", () => {
    const members = csharpEnumMembers(
      "Sitrep.Contract/UplinkContract.cs",
      "UplinkHealthState",
    );
    // Guards this reader the same way the generated-enum one is guarded above:
    // an extractor that quietly returned nothing would make any table pass.
    expect(members).toEqual(["Healthy", "Degraded", "Unavailable"]);
    expect([...HEALTH_STATE_NAMES]).toEqual(
      members.map((n) => n.toLowerCase()),
    );
  });

  /**
   * Not a name table but the same failure: a verdict indexed by ordinal. A
   * short one yields `undefined`, which CommSignal correctly paints neutral, so
   * an appended member would quietly stop being judged rather than break.
   */
  it("CONTROL_STATE_LEVEL carries a verdict for every ControlState member", () => {
    expect(CONTROL_STATE_LEVEL).toHaveLength(
      declaredNames(ControlState).length,
    );
  });

  /** The original defect, pinned by name so a regression reads as itself. */
  it("resolves a name for a docking-port target", () => {
    const names = ENUM_NAME_TABLES.find(
      (t) => t.label === "TARGET_KIND_NAMES",
    )?.names;
    expect(names?.[TargetKind.Part]).toBe("Part");
    expect(names?.[TargetKind.Position]).toBe("Position");
  });
});
