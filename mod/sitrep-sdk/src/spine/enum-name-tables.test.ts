import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as generated from "../__generated__/contract";
import {
  ControlState,
  KspActionGroup,
  KspPartCategory,
  Situation,
  TargetKind,
  TransitionType,
} from "../__generated__/contract";
import { namesOf } from "../enum-names";
import {
  actionGroupNames,
  KSP_ENUM_NAME_TABLES,
  KSP_PART_CATEGORY_NAMES,
  KSP_SPACE_CENTER_FACILITY_NAMES,
} from "../ksp-enum-names";
import { FACILITY_KEY_TO_ENUM } from "./map-command";
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

/**
 * Value→name pairs a generated numeric enum declares, in value order.
 *
 * The value-aware twin of `declaredNames`, for the KSP mirrors: those carry
 * KSP's own numbering, which includes a negative member and a bitmask, so
 * position in the declaration is not the fact being checked.
 */
function declaredValues(members: object): [number, string][] {
  return Object.entries(members)
    .filter(([key]) => Number.isInteger(Number(key)))
    .map(([key, name]): [number, string] => [Number(key), String(name)])
    .sort(([a], [b]) => a - b);
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

  /**
   * KSP's own enums, the half that had no declaration to derive from until
   * `Sitrep.Contract/KspEnums.cs` existed. Same property as the tables above,
   * checked on a `Map` rather than an array because two of these are not dense
   * from zero.
   */
  for (const { label, members, names } of KSP_ENUM_NAME_TABLES) {
    it(`${label} matches its enum`, () => {
      expect([...names].sort(([a], [b]) => a - b)).toEqual(
        declaredValues(members),
      );
    });
  }

  /**
   * The mistake `ksp-enum-names.ts` invites: declare an eighth mirror in C# and
   * never give the client a table for it. Derived from the generated module, so
   * a mirror added in the contract fails here until it is registered, rather
   * than being noticed by whoever eventually hits the missing name.
   */
  it("has a table registered for every Ksp* enum the contract exports", () => {
    const exported = Object.entries(generated)
      .filter(
        ([name, value]) =>
          name.startsWith("Ksp") &&
          typeof value === "object" &&
          value !== null &&
          Object.keys(value).some((k) => Number.isInteger(Number(k))),
      )
      .map(([name]) => name)
      .sort();
    // Guards this reader: a filter that matched nothing would make an empty
    // registry pass, so the count is pinned rather than only compared.
    expect(exported.length).toBeGreaterThanOrEqual(7);
    // Compared as sets: the registry reads in declaration order and the scan
    // reads alphabetically, and which order either is in is not the point.
    const registered = new Set(KSP_ENUM_NAME_TABLES.map((t) => t.members));
    const missing = exported.filter(
      (name) => !registered.has((generated as Record<string, object>)[name]),
    );
    expect(missing).toEqual([]);
    expect(registered.size).toBe(exported.length);
  });

  /**
   * `PartCategories.none` is `-1`, and a table built by the ordinal-walking
   * `namesOf` would resolve every member EXCEPT it, silently. Pinned because it
   * is the reason these tables are maps at all.
   */
  it("resolves the negative member of a sparse KSP enum", () => {
    expect(KSP_PART_CATEGORY_NAMES.get(-1)).toBe("none");
    expect(KSP_PART_CATEGORY_NAMES.get(KspPartCategory.Robotics)).toBe(
      "Robotics",
    );
    expect(namesOf(KspPartCategory)).not.toContain("none");
  });

  /**
   * The bitmask half. `namesOf` stops at the first gap in the value run, and on
   * this enum the run happens to reach 2 before it breaks, so it resolves
   * None/Stage/Gear and silently loses everything from `RCS` (8) upward -
   * including every Custom group, which is most of what an operator binds.
   * A table that covers the first three of eighteen members is worse than one
   * that covers none, because it looks like it works.
   */
  it("decodes a KSPActionGroup bitmask to every group set in it", () => {
    expect(namesOf(KspActionGroup)).toEqual(["None", "Stage", "Gear"]);
    expect(
      actionGroupNames(KspActionGroup.SAS | KspActionGroup.Custom01),
    ).toEqual(["SAS", "Custom01"]);
    expect(actionGroupNames(0)).toEqual([]);
    expect(actionGroupNames(null)).toEqual([]);
    // -1 has every bit set. Excluding REPLACEWITHDEFAULT and None keeps it from
    // reporting itself as a group, but the real groups it covers are genuine.
    expect(actionGroupNames(-1)).not.toContain("REPLACEWITHDEFAULT");
    expect(actionGroupNames(-1)).not.toContain("None");
    expect(actionGroupNames(-1)).toContain("Custom10");
  });

  /**
   * The legacy-key bridge's facility table, against KSP's own enum.
   *
   * `FACILITY_KEY_TO_ENUM` turns a short facility code into the enum NAME the
   * `career.facility.upgrade` command takes, and the mod re-resolves that name
   * server-side. The short codes are ours and have to be written down; the enum
   * names are KSP's and do not, so this is what catches one of them going stale.
   * A stale name reaches the mod as an id it cannot resolve, so the upgrade is
   * refused for a facility the operator can see and select.
   */
  it("FACILITY_KEY_TO_ENUM names only real SpaceCenterFacility members, and all of them", () => {
    const declared = new Set(KSP_SPACE_CENTER_FACILITY_NAMES.values());
    // Guards this reader: an empty set would make any table pass.
    expect(declared.size).toBe(9);
    const values = Object.values(FACILITY_KEY_TO_ENUM);
    expect(values.filter((v) => !declared.has(v))).toEqual([]);
    expect([...declared].filter((d) => !values.includes(d))).toEqual([]);
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
