import { describe, expect, it } from "vitest";
import { byExperiment } from "./grouping";
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
