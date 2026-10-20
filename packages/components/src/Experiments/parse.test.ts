import { describe, expect, it } from "vitest";
import { parseInstruments, parseLab } from "./parse";

describe("parseInstruments", () => {
  it("carries whether an instrument can be reset, and null when the wire did not say", () => {
    const parsed = parseInstruments([
      { partId: 1, rerunnable: false, resettable: true },
      { partId: 2, rerunnable: false, resettable: false },
      { partId: 3, rerunnable: false },
    ]);
    expect(parsed?.map((p) => p.resettable)).toEqual([true, false, null]);
  });
});

describe("parseInstruments rerunnable", () => {
  it("records whether the wire said an instrument is rerunnable, so null is not read as false", () => {
    const parsed = parseInstruments([
      { partId: 1, rerunnable: true },
      { partId: 2, rerunnable: false },
      { partId: 3, rerunnable: null },
      { partId: 4 },
    ]);
    expect(parsed?.map((p) => p.rerunnableKnown)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("titles each experiment by its own title and leaves an absent title undefined", () => {
    const parsed = parseInstruments([
      {
        partId: 1,
        partName: "Stayputnik",
        experimentId: "a",
        title: "Seismic Scan",
      },
      { partId: 1, partName: "Stayputnik", experimentId: "b", title: null },
    ]);
    expect(parsed?.map((p) => p.expTitle)).toEqual(["Seismic Scan", undefined]);
  });
});

describe("parseLab", () => {
  it("carries the value model a lab's figures are in, and null when untagged", () => {
    const parsed = parseLab([
      { partName: "Mobile Lab", valueModel: "stock" },
      { partName: "Pipeline Lab", valueModel: "pipeline" },
      { partName: "Untagged" },
    ]);
    expect(parsed?.map((l) => l.valueModel)).toEqual([
      "stock",
      "pipeline",
      null,
    ]);
  });
});
