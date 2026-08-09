import { describe, expect, it } from "vitest";
import {
  deriveGlyph,
  type InFlightCommandLike,
  journeyProgress,
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

  describe("journeyProgress (rail glow x-position)", () => {
    it("is ~0 at send and grows as the command travels (T = reply - reach)", () => {
      // Just sent: reach = T, reply = 2T -> elapsed 0.
      expect(
        journeyProgress(cmd({ reachEtaSeconds: 6, replyEtaSeconds: 12 })),
      ).toBeCloseTo(0, 5);
      // Past the reach point (reach negative): T=6, elapsed = 6 - (-2) = 8,
      // axis span 3T = 18 -> 8/18.
      expect(
        journeyProgress(cmd({ reachEtaSeconds: -2, replyEtaSeconds: 4 })),
      ).toBeCloseTo(8 / 18, 5);
    });

    it("clamps to [0,1] and rises monotonically along the journey", () => {
      const early = journeyProgress(
        cmd({ reachEtaSeconds: 5, replyEtaSeconds: 12 }),
      );
      const later = journeyProgress(
        cmd({ reachEtaSeconds: -5, replyEtaSeconds: 2 }),
      );
      expect(early).toBeGreaterThanOrEqual(0);
      expect(later).toBeLessThanOrEqual(1);
      expect(later).toBeGreaterThan(early);
    });

    it("falls back to a phase anchor when an eta is null", () => {
      const lost = journeyProgress(
        cmd({
          reachEtaSeconds: null,
          replyEtaSeconds: null,
          predictedPhase: "lost",
        }),
      );
      expect(lost).toBeGreaterThan(0.9);
    });

    it("is stamped onto the mapped item", () => {
      const [item] = toInFlightListItems([
        cmd({ reachEtaSeconds: -2, replyEtaSeconds: 4 }),
      ]);
      expect(item.progress).toBeCloseTo(8 / 18, 5);
    });
  });

  describe("queue glyph", () => {
    it("passes a supplied glyph through", () => {
      const [item] = toInFlightListItems([cmd({ glyph: "PRO" })]);
      expect(item.glyph).toBe("PRO");
    });

    it("derives a terse abbreviation from the label when no glyph is given", () => {
      expect(deriveGlyph("SAS Prograde")).toBe("PROG");
      expect(deriveGlyph("Set target")).toBe("TARG");
      expect(deriveGlyph("Warp")).toBe("WARP");
      // Mapped item gets the derived glyph.
      const [item] = toInFlightListItems([cmd({ label: "Set target" })]);
      expect(item.glyph).toBe("TARG");
    });
  });
});
