import { Situation, VesselType } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS } from "../LaunchDirector/index";
import {
  SPACE_OBJECT_VESSEL_TYPE,
  TARGET_PICKER_SITUATION_LABELS,
  TARGET_PICKER_VESSEL_TYPE_LABELS,
} from "./index";

/**
 * T3 drift guard (producer-consumer-T3): TargetPicker's and LaunchDirector's
 * `VESSEL_TYPE_LABELS`/`SITUATION_LABELS` arrays are hand-ordered to match the
 * C# `VesselType`/`Situation` enum declaration order (`VesselEnums.cs`), with
 * no compile-time coupling to the generated SDK enums that ARE the source of
 * truth (`mod/sitrep-sdk/src/__generated__/contract.ts`, generated off the C#
 * contract). An inserted C# enum member would silently mis-label every row
 * here with nothing to catch it.
 *
 * This test locks that alignment: it walks the generated enum's own ordinal
 * order and asserts each label array has the matching entry at the matching
 * index. If a C# enum member is inserted, renamed, or reordered, this test
 * fails the same day the SDK is regenerated; instead of a silent label
 * drift discovered by an operator reading the wrong vessel type off a row.
 */

/** Forward `name -> ordinal` entries only: filters out the reverse
 * `ordinal -> name` entries TypeScript's numeric-enum runtime object also
 * carries, sorted into the enum's declared order. */
function enumMembersByOrdinal(
  enumObject: Record<string, string | number>,
): string[] {
  return Object.entries(enumObject)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name);
}

// The only allowed divergence between an enum member's bare PascalCase name
// and its display label: everything else must match verbatim.
const SITUATION_DISPLAY_OVERRIDES: Readonly<Record<string, string>> = {
  PreLaunch: "Pre-Launch",
  SubOrbital: "Sub-Orbital",
};

function expectIndexAligned(
  labels: readonly string[],
  members: readonly string[],
  overrides: Readonly<Record<string, string>>,
  arrayName: string,
) {
  expect(
    labels.length,
    `${arrayName} has ${labels.length} entries but the enum declares ${members.length} members, an enum member was added, removed, or the array wasn't updated to match`,
  ).toBe(members.length);
  members.forEach((memberName, ordinal) => {
    const expected = overrides[memberName] ?? memberName;
    expect(
      labels[ordinal],
      `${arrayName}[${ordinal}] should be "${expected}" for enum member ${memberName} (ordinal ${ordinal}), but was "${labels[ordinal]}", the array has drifted out of index-alignment with the enum`,
    ).toBe(expected);
  });
}

describe("T3: label arrays stay index-aligned with the generated SDK enums", () => {
  const vesselTypeMembers = enumMembersByOrdinal(
    VesselType as unknown as Record<string, string | number>,
  );
  const situationMembers = enumMembersByOrdinal(
    Situation as unknown as Record<string, string | number>,
  );

  it("VesselType enum has the members this test expects (sanity check on the enum walk itself)", () => {
    expect(vesselTypeMembers).toEqual([
      "Ship",
      "Station",
      "Lander",
      "Probe",
      "Rover",
      "Base",
      "Relay",
      "EVA",
      "Flag",
      "Debris",
      "SpaceObject",
      "DeployedScienceController",
      "DeployedSciencePart",
      "DroppedPart",
      "Unknown",
    ]);
  });

  it("TargetPicker's VESSEL_TYPE_LABELS matches VesselType's declared order", () => {
    expectIndexAligned(
      TARGET_PICKER_VESSEL_TYPE_LABELS,
      vesselTypeMembers,
      {},
      "TargetPicker VESSEL_TYPE_LABELS",
    );
  });

  it("LaunchDirector's VESSEL_TYPE_LABELS matches VesselType's declared order", () => {
    expectIndexAligned(
      LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS,
      vesselTypeMembers,
      {},
      "LaunchDirector VESSEL_TYPE_LABELS",
    );
  });

  it("TargetPicker's SITUATION_LABELS matches Situation's declared order", () => {
    expectIndexAligned(
      TARGET_PICKER_SITUATION_LABELS,
      situationMembers,
      SITUATION_DISPLAY_OVERRIDES,
      "TargetPicker SITUATION_LABELS",
    );
  });

  it("SPACE_OBJECT_VESSEL_TYPE is derived from VesselType.SpaceObject, not a bare literal", () => {
    expect(SPACE_OBJECT_VESSEL_TYPE).toBe(VesselType.SpaceObject);
  });

  it("fails if the label arrays and the enum diverge (self-check on the guard itself)", () => {
    const driftedLabels = [...TARGET_PICKER_VESSEL_TYPE_LABELS];
    // Simulate a C# enum insertion shifting everything after it by one,
    // this must NOT still pass the alignment check.
    driftedLabels.splice(2, 0, "InsertedMember");
    expect(() =>
      expectIndexAligned(
        driftedLabels,
        vesselTypeMembers,
        {},
        "drifted VESSEL_TYPE_LABELS",
      ),
    ).toThrow();
  });
});
