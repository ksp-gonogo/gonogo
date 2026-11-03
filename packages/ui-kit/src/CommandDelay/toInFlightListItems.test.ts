import { describe, expect, it } from "vitest";
import {
  deriveGlyph,
  type InFlightCommandLike,
  journeyProgress,
  secondsToRailEnd,
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
      // Past the reach point (reach negative): T=6, elapsed = 6 - (-2) = 8, axis span 3T = 18 -> 8/18.
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
      expect(lost).toBeCloseTo(2 / 3, 5);
    });

    it("reaches the craft at a third, and waits at two thirds for a reply that is due or late", () => {
      // Sent with T = 6: at the craft 6 s after sending, the reply due at 12 s.
      expect(
        journeyProgress(cmd({ reachEtaSeconds: 0, replyEtaSeconds: 6 })),
      ).toBeCloseTo(1 / 3, 5);
      expect(
        journeyProgress(cmd({ reachEtaSeconds: -6, replyEtaSeconds: 0 })),
      ).toBeCloseTo(2 / 3, 5);
      expect(
        journeyProgress(
          cmd({
            reachEtaSeconds: -20,
            replyEtaSeconds: -14,
            predictedPhase: "overdue",
          }),
        ),
      ).toBeCloseTo(2 / 3, 5);
    });

    it("sends an answered command on to the end over the time the last third takes", () => {
      const answered = cmd({ reachEtaSeconds: -6, replyEtaSeconds: 0 });
      expect(secondsToRailEnd(answered)).toBeCloseTo(6, 5);
      const [item] = toInFlightListItems([
        { ...answered, settling: "confirmed", settleSeconds: 6 },
      ]);
      expect(item).toMatchObject({
        settling: "confirmed",
        settleSeconds: 6,
        progress: 1,
      });
    });

    it("keeps a refused command where it was", () => {
      const [item] = toInFlightListItems([
        {
          ...cmd({ reachEtaSeconds: -6, replyEtaSeconds: 0 }),
          settling: "failed",
        },
      ]);
      expect(item.settling).toBe("failed");
      expect(item.progress).toBeCloseTo(2 / 3, 5);
    });

    it("places a held command where its hold says it is on the way out", () => {
      const at = (outbound: number, reachCraft: number) =>
        journeyProgress({
          ...cmd({
            reachEtaSeconds: reachCraft,
            replyEtaSeconds: reachCraft + 12,
          }),
          hold: { outbound },
        });
      // Waiting at a relay a third of the way out: a ninth of the rail, however long it waits.
      expect(at(1 / 3, 40)).toBeCloseTo(1 / 9, 5);
      expect(at(1 / 3, 20)).toBeCloseTo(1 / 9, 5);
      expect(at(2 / 3, 4)).toBeCloseTo(2 / 9, 5);
    });

    it("marks a command held at a relay", () => {
      const [item] = toInFlightListItems([{ ...cmd({}), held: true }]);
      expect(item.held).toBe(true);
    });

    it("is stamped onto the mapped item", () => {
      const [item] = toInFlightListItems([
        cmd({ reachEtaSeconds: -2, replyEtaSeconds: 4 }),
      ]);
      expect(item.progress).toBeCloseTo(8 / 18, 5);
    });
  });

  describe("a queue merged from several handles", () => {
    it("is in the order the commands were sent", () => {
      const items = toInFlightListItems([
        { ...cmd({ label: "SAS" }), id: "b", dispatchedAt: 1002 },
        { ...cmd({ label: "RCS" }), id: "a", dispatchedAt: 1000 },
        { ...cmd({ label: "Precision" }), id: "c", dispatchedAt: 1001 },
      ]);
      expect(items.map((i) => i.id)).toEqual(["a", "c", "b"]);
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

describe("a transmission's row", () => {
  // Sent 1s ago under a 4s one-way delay, arriving in 3s, nothing coming back.
  const transmission = cmd({
    label: "Crew Report",
    command: "crewReport@KerbinSrfLandedShores",
    reachEtaSeconds: 3,
    replyEtaSeconds: null,
    oneWaySeconds: 4,
    direction: "telemetry",
  });

  it("is drawn inbound, counting down to its arrival", () => {
    const [item] = toInFlightListItems([transmission]);
    expect(item.flow).toBe("inbound");
    expect(item.etaSeconds).toBe(3);
  });

  it("is placed by the delay it was sent under, having no reply leg to measure", () => {
    expect(journeyProgress(transmission)).toBeCloseTo(1 / 12);
  });

  it("leaves a command's row outbound and unmarked", () => {
    const [item] = toInFlightListItems([cmd({ direction: "command" })]);
    expect(item).not.toHaveProperty("flow");
  });
});
