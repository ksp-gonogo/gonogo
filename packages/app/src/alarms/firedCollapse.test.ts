import { describe, expect, it } from "vitest";
import { collapseFiredContractParam } from "./firedCollapse";
import type { Alarm } from "./types";

function cp(id: string, state: Alarm["state"] = "fired"): Alarm {
  return {
    id,
    name: `Param ${id}`,
    state,
    matchSinceUT: null,
    createdBy: "main",
    createdAt: 0,
    trigger: {
      kind: "contract-parameter",
      contractId: 123,
      parameterTitle: `Param ${id}`,
      targetState: "Complete",
      sustainSeconds: 0,
    },
  };
}

function threshold(id: string, state: Alarm["state"] = "fired"): Alarm {
  return {
    id,
    name: `Threshold ${id}`,
    state,
    matchSinceUT: null,
    createdBy: "main",
    createdAt: 0,
    trigger: {
      kind: "threshold",
      dataKey: "v.altitude",
      op: ">",
      value: 1000,
      sustainSeconds: 0,
    },
  };
}

describe("collapseFiredContractParam", () => {
  it("returns null when no contract-parameter fires", () => {
    expect(
      collapseFiredContractParam([threshold("a"), threshold("b")]),
    ).toBeNull();
  });

  it("returns null when only one contract-parameter fired", () => {
    expect(collapseFiredContractParam([cp("a"), threshold("b")])).toBeNull();
  });

  it("collapses two or more fired contract-parameter alarms", () => {
    const result = collapseFiredContractParam([
      cp("a"),
      cp("b"),
      threshold("c"),
    ]);
    expect(result).toEqual({ count: 2, ids: ["a", "b"] });
  });

  it("only counts fired contract-parameter alarms (caller filters by state)", () => {
    // The helper assumes the caller has already filtered to state === "fired".
    // Mixing pending CPs in should be caught at the caller, not here.
    const result = collapseFiredContractParam([cp("a"), cp("b"), cp("c")]);
    expect(result?.count).toBe(3);
    expect(result?.ids).toEqual(["a", "b", "c"]);
  });
});
