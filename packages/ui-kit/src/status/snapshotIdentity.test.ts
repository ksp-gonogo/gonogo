import { describe, expect, it } from "vitest";
import { createPanelStatusStore } from "./PanelStatusStore";

describe("PanelStatusStore snapshots keep their identity while the store is unchanged", () => {
  it("holds through every reachable state", () => {
    const store = createPanelStatusStore();
    const states: Array<[string, () => void]> = [
      ["empty", () => {}],
      [
        "one entry",
        () => void store.register({ id: "a", severity: "warn", label: "A" }),
      ],
      [
        "a second, lower entry",
        () => void store.register({ id: "b", severity: "info", label: "B" }),
      ],
      [
        "a label-only update",
        () => store.update("a", { severity: "warn", label: "A2" }),
      ],
      [
        "a no-op update",
        () => store.update("a", { severity: "warn", label: "A2" }),
      ],
      [
        "an unknown id update",
        () => store.update("zzz", { severity: "warn", label: "" }),
      ],
    ];
    for (const [name, apply] of states) {
      apply();
      expect(store.getSummary(), name).toBe(store.getSummary());
      expect(store.getBreakdown(), name).toBe(store.getBreakdown());
    }
  });

  it("returns the same summary and breakdown after a register and deregister in one tick", () => {
    const store = createPanelStatusStore();
    const before = [store.getSummary(), store.getBreakdown()];
    store.register({ id: "a", severity: "warn", label: "A" })();
    expect([store.getSummary(), store.getBreakdown()]).toEqual(before);
    expect(store.getBreakdown()).toBe(before[1]);
    expect(store.getSummary()).toBe(store.getSummary());
  });
});
