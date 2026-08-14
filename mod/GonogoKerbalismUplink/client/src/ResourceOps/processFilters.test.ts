import type { IsruConverterEntry } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { computeKerbalismProcessTerms } from "./processFilters";

/** A converter carrying Kerbalism's own extension namespace, the shape
 *  `readKerbalismIsruConverterExt` reads a process title back out of. */
function converter(
  partTitle: string,
  ext?: { title?: string; processToken?: string },
): IsruConverterEntry {
  return {
    partId: partTitle,
    partTitle,
    running: true,
    inputs: [],
    outputs: [],
    ...(ext ? { extensions: { kerbalism: ext } } : {}),
  } as unknown as IsruConverterEntry;
}

describe("computeKerbalismProcessTerms", () => {
  it("returns the distinct process titles, in first-seen order", () => {
    const terms = computeKerbalismProcessTerms([
      converter("CO2 Scrubber", {
        title: "Scrubber",
        processToken: "_Scrubber",
      }),
      converter("Water Recycler", {
        title: "Water Recycler",
        processToken: "_WaterRecycler",
      }),
      // A second unit of the same process contributes no second term.
      converter("Water Recycler B", {
        title: "Water Recycler",
        processToken: "_WaterRecycler",
      }),
    ]);
    expect(terms).toEqual(["Scrubber", "Water Recycler"]);
  });

  it("contributes no term for a converter the profile did not name", () => {
    const terms = computeKerbalismProcessTerms([
      converter("Convert-O-Tron 250"), // no Kerbalism extension at all
      converter("Blank", { processToken: "_X" }), // token but no title
      converter("Sabatier Process", { title: "Sabatier Process" }),
    ]);
    expect(terms).toEqual(["Sabatier Process"]);
  });

  it("is empty for no converters", () => {
    expect(computeKerbalismProcessTerms(undefined)).toEqual([]);
    expect(computeKerbalismProcessTerms([])).toEqual([]);
  });
});
