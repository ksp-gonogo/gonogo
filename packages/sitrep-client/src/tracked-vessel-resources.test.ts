import { describe, expect, it } from "vitest";
import { trackedVesselResourceList } from "./tracked-vessel-resources";

describe("trackedVesselResourceList", () => {
  it("turns the wire map into rows carrying their own name", () => {
    const rows = trackedVesselResourceList({
      resources: {
        LiquidFuel: { current: 120, max: 400, active: true },
      },
    });
    expect(rows).toEqual([
      { name: "LiquidFuel", current: 120, max: 400, active: true },
    ]);
  });

  it("unwraps unit-carrying amounts as readily as bare ones", () => {
    const rows = trackedVesselResourceList({
      resources: {
        Oxidizer: { current: { magnitude: 50 }, max: { magnitude: 200 } },
      },
    });
    expect(rows[0]).toMatchObject({ current: 50, max: 200 });
  });

  it("sorts by name, so a re-emission cannot reorder the rows mid-read", () => {
    // The wire map's key order is not a promise, and rows shuffling under an operator's eyes is worse than any particular order.
    const rows = trackedVesselResourceList({
      resources: {
        Oxidizer: { current: 1, max: 2 },
        ElectricCharge: { current: 1, max: 2 },
        LiquidFuel: { current: 1, max: 2 },
      },
    });
    expect(rows.map((r) => r.name)).toEqual([
      "ElectricCharge",
      "LiquidFuel",
      "Oxidizer",
    ]);
  });

  it("keeps a tank the craft carries but has emptied", () => {
    // The reading an operator most wants. Dropping it would make "ran out"
    // indistinguishable from "never carried it".
    const rows = trackedVesselResourceList({
      resources: { MonoPropellant: { current: 0, max: 40 } },
    });
    expect(rows[0]).toMatchObject({ current: 0, max: 40 });
  });

  it("drops a row whose amounts cannot be read rather than showing zero", () => {
    const rows = trackedVesselResourceList({
      resources: {
        Broken: { current: null, max: 40 },
        Fine: { current: 1, max: 2 },
      },
    });
    expect(rows.map((r) => r.name)).toEqual(["Fine"]);
  });

  it("treats an unstated active flag as reported, never as stale", () => {
    const rows = trackedVesselResourceList({
      resources: { Ore: { current: 1, max: 2 } },
    });
    expect(rows[0].active).toBe(true);
  });

  it("carries an explicit false through", () => {
    const rows = trackedVesselResourceList({
      resources: { Ore: { current: 1, max: 2, active: false } },
    });
    expect(rows[0].active).toBe(false);
  });

  it("reads a craft carrying nothing as an empty list, not a broken one", () => {
    expect(trackedVesselResourceList({ resources: {} })).toEqual([]);
    expect(trackedVesselResourceList({})).toEqual([]);
    expect(trackedVesselResourceList({ resources: null })).toEqual([]);
  });
});
