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
