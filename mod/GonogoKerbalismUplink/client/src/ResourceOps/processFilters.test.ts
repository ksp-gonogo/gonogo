import {
  type IsruConverterEntry,
  PROVIDER_EXTENSIONS_FIELD,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { KERBALISM_ISRU_PROVIDER_ID } from "../isru";
import {
  computeKerbalismProcessFilters,
  resetProcessFilterCache,
} from "./processFilters";

/** A converter row carrying this Uplink's namespace, the way a live frame does. */
function converter(
  partId: string,
  ext: { processToken?: string; title?: string; broken?: boolean },
): IsruConverterEntry {
  return {
    partId,
    partTitle: null,
    running: true,
    inputs: [],
    outputs: [],
    [PROVIDER_EXTENSIONS_FIELD]: { [KERBALISM_ISRU_PROVIDER_ID]: ext },
  } as unknown as IsruConverterEntry;
}

const SCRUBBER = converter("301", {
  processToken: "_Scrubber",
  title: "Scrubber",
});
const RECYCLER = converter("302", {
  processToken: "_WaterRecycler",
  title: "Water Recycler",
});
const MRE = converter("303", { processToken: "_MRE" });

type Unit = Parameters<
  ReturnType<typeof computeKerbalismProcessFilters>[number]["predicate"]
>[0];

const unitOf = (entry: IsruConverterEntry): Unit =>
  ({ kind: "converter", converter: entry }) as Unit;
const DRILL_UNIT = {
  kind: "drill",
  drill: { partId: "101", resource: "Ore" },
} as unknown as Unit;

afterEach(() => {
  resetProcessFilterCache();
});

describe("Kerbalism's contributed process filters", () => {
  it("names one facet per process, using Kerbalism's own title", () => {
    const filters = computeKerbalismProcessFilters([SCRUBBER, RECYCLER]);

    expect(filters.map((f) => f.label)).toEqual(["Scrubber", "Water Recycler"]);
  });

  it("falls back to the process token when the profile carries no title", () => {
    // Still Kerbalism's own identifier, never a name gonogo invented for it.
    const filters = computeKerbalismProcessFilters([SCRUBBER, MRE]);

    expect(filters.map((f) => f.label)).toEqual(["Scrubber", "_MRE"]);
  });

  it("declares one multi-select axis, so two processes can be shown together", () => {
    const filters = computeKerbalismProcessFilters([SCRUBBER, RECYCLER]);

    expect(filters.every((f) => f.group === "kerbalism-process")).toBe(true);
    expect(filters.every((f) => f.selection === "multi")).toBe(true);
  });

  it("matches only its own process, and never a drill", () => {
    const filters = computeKerbalismProcessFilters([SCRUBBER, RECYCLER]);
    const scrubber = filters.find((f) => f.label === "Scrubber");

    expect(scrubber?.predicate(unitOf(SCRUBBER))).toBe(true);
    expect(scrubber?.predicate(unitOf(RECYCLER))).toBe(false);
    // Asking for the scrubber is not asking to also see the vessel's ore drill.
    expect(scrubber?.predicate(DRILL_UNIT)).toBe(false);
  });

  it("offers Broken only while something actually is", () => {
    expect(
      computeKerbalismProcessFilters([SCRUBBER, RECYCLER]).some(
        (f) => f.label === "Broken",
      ),
    ).toBe(false);

    resetProcessFilterCache();
    const broken = converter("304", {
      processToken: "_Greenhouse",
      title: "Greenhouse",
      broken: true,
    });
    const filters = computeKerbalismProcessFilters([SCRUBBER, broken]);
    const brokenFilter = filters.find((f) => f.label === "Broken");

    // Its own standalone axis, not a facet of the process one.
    expect(brokenFilter?.group).toBeUndefined();
    expect(brokenFilter?.predicate(unitOf(broken))).toBe(true);
    expect(brokenFilter?.predicate(unitOf(SCRUBBER))).toBe(false);
  });

  it("contributes nothing when only one process is aboard", () => {
    expect(computeKerbalismProcessFilters([SCRUBBER])).toEqual([]);
  });

  it("contributes nothing on a frame with no Kerbalism namespace at all", () => {
    // A stock frame carries no bag, so this Uplink has nothing to say and the
    // widget shows the built-in by-resource axis alone.
    const stock = {
      partId: "401",
      running: true,
      inputs: [],
      outputs: [],
    } as unknown as IsruConverterEntry;

    expect(computeKerbalismProcessFilters([stock, stock])).toEqual([]);
    expect(computeKerbalismProcessFilters(undefined)).toEqual([]);
  });

  it("returns the same entries while the process set is unchanged", () => {
    const first = computeKerbalismProcessFilters([SCRUBBER, RECYCLER]);
    const second = computeKerbalismProcessFilters([SCRUBBER, RECYCLER]);

    expect(second).toBe(first);
  });
});
