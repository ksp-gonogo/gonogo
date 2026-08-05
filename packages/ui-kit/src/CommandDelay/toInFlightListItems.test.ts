import { describe, expect, it } from "vitest";
import {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./toInFlightListItems";

function cmd(over: Partial<InFlightCommandLike>): InFlightCommandLike {
  return {
    id: "req-1",
    label: "Toggle SAS",
    command: "vessel.control.sas",
    reachEtaSeconds: 4,
    replyEtaSeconds: 8,
    predictedPhase: "in-transit",
    ...over,
  };
}

describe("toInFlightListItems", () => {
  it("shows the reach eta while in-transit", () => {
    const [item] = toInFlightListItems([cmd({ predictedPhase: "in-transit" })]);
    expect(item.etaSeconds).toBe(4);
    expect(item.phase).toBe("in-transit");
  });

  it("shows the reply eta once past in-transit", () => {
    for (const phase of ["awaiting-reply", "due", "overdue", "lost"] as const) {
      const [item] = toInFlightListItems([cmd({ predictedPhase: phase })]);
      expect(item.etaSeconds).toBe(8);
      expect(item.phase).toBe(phase);
    }
  });

  it("falls back to the command id when no label was carried", () => {
    const [item] = toInFlightListItems([cmd({ label: "" })]);
    expect(item.label).toBe("vessel.control.sas");
  });

  it("carries a null eta through unchanged", () => {
    const [item] = toInFlightListItems([
      cmd({ predictedPhase: "in-transit", reachEtaSeconds: null }),
    ]);
    expect(item.etaSeconds).toBeNull();
  });

  it("maps every entry, preserving order and id", () => {
    const items = toInFlightListItems([
      cmd({ id: "a" }),
      cmd({ id: "b" }),
      cmd({ id: "c" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
