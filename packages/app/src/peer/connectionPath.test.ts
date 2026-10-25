import { describe, expect, it } from "vitest";
import { readConnectionPath } from "./connectionPath";

function stats(local: string, remote: string) {
  const entries: Array<Record<string, unknown>> = [
    { id: "T", type: "transport", selectedCandidatePairId: "P" },
    {
      id: "P",
      type: "candidate-pair",
      localCandidateId: "L",
      remoteCandidateId: "R",
    },
    { id: "L", type: "local-candidate", candidateType: local },
    { id: "R", type: "remote-candidate", candidateType: remote },
  ];
  return {
    getStats: async () => ({
      forEach: (cb: (s: Record<string, unknown>) => void) =>
        entries.forEach(cb),
    }),
  };
}

describe("readConnectionPath", () => {
  it.each([
    ["host", "host", "lan"],
    ["srflx", "host", "internet"],
    ["srflx", "srflx", "internet"],
    ["host", "relay", "relayed"],
    ["relay", "srflx", "relayed"],
  ])("reads %s + %s as %s", async (l, r, want) => {
    expect(await readConnectionPath(stats(l, r))).toBe(want);
  });

  it("is null with no selected pair", async () => {
    const empty = {
      getStats: async () => ({ forEach: () => {} }),
    };
    expect(await readConnectionPath(empty)).toBeNull();
  });
});
