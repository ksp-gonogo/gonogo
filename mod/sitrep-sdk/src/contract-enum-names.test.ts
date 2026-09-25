import { describe, expect, it } from "vitest";
import { ControlState, SasMode, Situation } from "./__generated__/contract";
import {
  CONTROL_STATE_NAMES,
  collapseControlStateLevel,
  enumNameOf,
  SAS_MODE_NAMES,
  SITUATION_NAMES,
} from "./contract-enum-names";

describe("enumNameOf", () => {
  it("resolves a wire ordinal to its member name", () => {
    expect(enumNameOf(SITUATION_NAMES, Situation.Orbiting)).toBe("Orbiting");
    expect(enumNameOf(SAS_MODE_NAMES, SasMode.Prograde)).toBe("Prograde");
    expect(enumNameOf(CONTROL_STATE_NAMES, ControlState.Full)).toBe("Full");
  });

  it("resolves the first and last members of a table", () => {
    expect(enumNameOf(SAS_MODE_NAMES, 0)).toBe("StabilityAssist");
    expect(enumNameOf(SITUATION_NAMES, SITUATION_NAMES.length - 1)).toBe(
      "Unknown",
    );
    expect(
      enumNameOf(CONTROL_STATE_NAMES, CONTROL_STATE_NAMES.length - 1),
    ).toBe("Unknown");
  });

  it("answers undefined for an ordinal the table does not carry", () => {
    expect(enumNameOf(SITUATION_NAMES, 99)).toBeUndefined();
    expect(enumNameOf(SITUATION_NAMES, -1)).toBeUndefined();
  });

  it("answers undefined for a field that did not arrive", () => {
    expect(enumNameOf(SAS_MODE_NAMES, null)).toBeUndefined();
    expect(enumNameOf(SAS_MODE_NAMES, undefined)).toBeUndefined();
  });
});

describe("collapseControlStateLevel", () => {
  it("collapses each control state onto full, partial or none", () => {
    expect({
      none: collapseControlStateLevel(ControlState.None),
      probe: collapseControlStateLevel(ControlState.Probe),
      kerbal: collapseControlStateLevel(ControlState.Kerbal),
      partial: collapseControlStateLevel(ControlState.Partial),
      full: collapseControlStateLevel(ControlState.Full),
      probeNone: collapseControlStateLevel(ControlState.ProbeNone),
      probePartial: collapseControlStateLevel(ControlState.ProbePartial),
      probeFull: collapseControlStateLevel(ControlState.ProbeFull),
      kerbalNone: collapseControlStateLevel(ControlState.KerbalNone),
      kerbalPartial: collapseControlStateLevel(ControlState.KerbalPartial),
      kerbalFull: collapseControlStateLevel(ControlState.KerbalFull),
    }).toEqual({
      none: 0,
      probe: 2,
      kerbal: 2,
      partial: 1,
      full: 2,
      probeNone: 0,
      probePartial: 1,
      probeFull: 2,
      kerbalNone: 0,
      kerbalPartial: 1,
      kerbalFull: 2,
    });
  });

  it("has no level for Unknown or for an ordinal past the enum", () => {
    expect(collapseControlStateLevel(ControlState.Unknown)).toBeUndefined();
    expect(collapseControlStateLevel(99)).toBeUndefined();
  });
});
