import { describe, expect, it } from "vitest";
import { byExperiment, byPart } from "./grouping";
import type { TitledInstrument } from "./instrument";

function instrument(
  partId: string,
  expId: string,
  expTitle?: string,
): TitledInstrument {
  return {
    partId,
    partTitle: partId,
    expId,
    ...(expTitle === undefined ? {} : { expTitle }),
    deployed: false,
    hasData: false,
    rerunnable: true,
    inoperable: false,
  };
}

describe("byExperiment", () => {
  it("orders by title where there is one, else by id", () => {
    const sorted = byExperiment([
      instrument("a", "zeta", "Barometer Scan"),
      instrument("b", "alpha"),
      instrument("c", "mid", "Crew Report"),
    ]);
    expect(sorted.map((i) => i.partId)).toEqual(["b", "a", "c"]);
  });

  it("puts an instrument that names no experiment after every named one", () => {
    const sorted = byExperiment([
      instrument("none", ""),
      instrument("named", "goo"),
    ]);
    expect(sorted.map((i) => i.partId)).toEqual(["named", "none"]);
  });
});

describe("byPart", () => {
  it("names a part once with its experiments beneath, in first-seen part order", () => {
    const groups = byPart([
      { ...instrument("p1", "seismicScan"), partTitle: "Stayputnik" },
      { ...instrument("p2", "mysteryGoo"), partTitle: "Goo" },
      { ...instrument("p1", "geigerCounter"), partTitle: "Stayputnik" },
    ]);
    expect(groups.map((g) => g.partTitle)).toEqual(["Stayputnik", "Goo"]);
    expect(groups[0].items.map((i) => i.expId)).toEqual([
      "geigerCounter",
      "seismicScan",
    ]);
  });
});
