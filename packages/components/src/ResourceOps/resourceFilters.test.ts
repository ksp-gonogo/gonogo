import type {
  IsruConverterEntry,
  IsruDrillEntry,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeResourceFilters,
  resetResourceFilterCache,
} from "./resourceFilters";
import type { ResourceOpsUnit } from "./unit";

const DRILLS = [
  { partId: "101", resource: "Ore", running: true },
] as unknown as IsruDrillEntry[];

const CONVERTERS = [
  {
    partId: "201",
    running: true,
    inputs: [{ resource: "Ore" }],
    outputs: [{ resource: "LiquidFuel" }],
  },
] as unknown as IsruConverterEntry[];

const drillUnit: ResourceOpsUnit = { kind: "drill", drill: DRILLS[0] };
const converterUnit: ResourceOpsUnit = {
  kind: "converter",
  converter: CONVERTERS[0],
};

afterEach(() => {
  resetResourceFilterCache();
});

describe("the built-in by-resource filters", () => {
  it("names every resource either side of a recipe, plus each drill's own", () => {
    const filters = computeResourceFilters(DRILLS, CONVERTERS);

    expect(filters.map((f) => f.label)).toEqual(["LiquidFuel", "Ore"]);
  });

  it("declares one axis, single-select, so the semantics never depend on vessel state", () => {
    const filters = computeResourceFilters(DRILLS, CONVERTERS);

    expect(new Set(filters.map((f) => f.group))).toEqual(new Set(["resource"]));
    expect(filters.every((f) => f.selection === "single")).toBe(true);
  });

  it("matches a drill on its own resource and a converter on either side of its recipe", () => {
    const filters = computeResourceFilters(DRILLS, CONVERTERS);
    const ore = filters.find((f) => f.id === "Ore");
    const fuel = filters.find((f) => f.id === "LiquidFuel");

    expect(ore?.predicate(drillUnit)).toBe(true);
    expect(ore?.predicate(converterUnit)).toBe(true);
    // Filtering on the OUTPUT finds the converter that makes it, and not the
    // ore drill that has nothing to do with it.
    expect(fuel?.predicate(converterUnit)).toBe(true);
    expect(fuel?.predicate(drillUnit)).toBe(false);
  });

  it("contributes nothing when there is only one resource to choose between", () => {
    // A single facet on its own axis is a control that can only ever repeat
    // what the unfiltered list already says.
    expect(computeResourceFilters(DRILLS, [])).toEqual([]);
  });

  it("contributes nothing on an empty vessel, or before the stream reports", () => {
    expect(computeResourceFilters([], [])).toEqual([]);
    expect(computeResourceFilters(undefined, undefined)).toEqual([]);
  });

  it("returns the same entries while the resource set is unchanged", () => {
    // Reference stability matters: the aggregator compares entries by
    // reference, so rebuilding predicates on every live rate update would
    // re-render the filter bar every frame.
    const first = computeResourceFilters(DRILLS, CONVERTERS);
    const second = computeResourceFilters(DRILLS, CONVERTERS);

    expect(second).toBe(first);
  });
});
