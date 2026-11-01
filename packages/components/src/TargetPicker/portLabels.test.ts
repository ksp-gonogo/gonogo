import { TargetKind, type TargetListEntry } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { numberSharedPortNames } from "./entries";

const port = (
  partId: number,
  name = "Target Docking Port",
  vesselId = "v1",
): TargetListEntry => ({
  kind: TargetKind.Part,
  name,
  vesselId,
  partId,
  isCurrent: false,
});

describe("numberSharedPortNames", () => {
  it("gives each port of one craft sharing a name its own number, in part id order", () => {
    const out = numberSharedPortNames([port(30), port(10), port(20)]);
    expect(out.map((e) => `${e.name}|${e.partId}`)).toEqual([
      "Target Docking Port 3|30",
      "Target Docking Port 1|10",
      "Target Docking Port 2|20",
    ]);
  });

  it("leaves a lone port, other craft and non-port entries alone", () => {
    const body: TargetListEntry = {
      kind: TargetKind.Body,
      name: "Mun",
      isCurrent: false,
    };
    const out = numberSharedPortNames([
      port(1),
      port(2, "Target Docking Port", "v2"),
      body,
    ]);
    expect(out.map((e) => e.name)).toEqual([
      "Target Docking Port",
      "Target Docking Port",
      "Mun",
    ]);
  });
});
