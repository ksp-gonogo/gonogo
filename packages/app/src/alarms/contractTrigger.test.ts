import { describe, expect, it } from "vitest";
import { parseTrigger } from "./types";

describe("parseTrigger: contract-parameter", () => {
  const base = {
    kind: "contract-parameter",
    parameterTitle: "Orbit Kerbin",
    targetState: "Complete",
    sustainSeconds: 0,
  };

  it("keeps a contract id beyond the safe integer range exactly", () => {
    const id = "18834021456123789";
    expect(parseTrigger({ ...base, contractId: id })).toEqual({
      ...base,
      contractId: id,
    });
  });

  it("refuses a numeric contract id", () => {
    expect(parseTrigger({ ...base, contractId: 42 })).toBeNull();
  });
});
