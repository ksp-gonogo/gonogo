import { describe, expect, it } from "vitest";
import { ArrivalBacklog, HostPacer, StationPacer } from "./stationPace";

const KEEPING_UP = { loopLagMs: 5, frameMs: 16, backlogMs: 0 };

describe("StationPacer", () => {
  it("sends everything until the station's queue backs up, then halves the rate", () => {
    const pacer = new StationPacer();
    expect(pacer.look(1_000, 10, 0)).toBe("hold");
    expect(pacer.heldRate()).toBeNull();

    expect(pacer.look(400_000, 10, 1_000)).toBe("down");
    expect(pacer.heldRate()).toBe(5);
  });

  it("waits for the queue to answer before halving again, and stops at once a second", () => {
    const pacer = new StationPacer();
    pacer.look(400_000, 10, 0);
    expect(pacer.look(400_000, 10, 1_000)).toBe("hold");
    expect(pacer.look(400_000, 10, 2_000)).toBe("down");
    expect(pacer.heldRate()).toBe(2);
    pacer.look(400_000, 10, 4_000);
    expect(pacer.heldRate()).toBe(1);
    expect(pacer.look(400_000, 10, 6_000)).toBe("hold");
    expect(pacer.heldRate()).toBe(1);
  });

  it("slows a station that says it is behind even with an empty queue, once a whole window has been read since the last change", () => {
    const pacer = new StationPacer();
    pacer.note = { ...KEEPING_UP, backlogMs: 2_500 };
    expect(pacer.look(0, 10, 0)).toBe("down");
    pacer.note = { ...KEEPING_UP, frameMs: 250 };
    expect(pacer.look(0, 10, 3_000)).toBe("hold");
    expect(pacer.look(0, 10, 6_000)).toBe("down");
  });

  it("climbs straight back below the rate that fell behind, then tries that rate after a longer wait, and lets go at the mod's rate", () => {
    const pacer = new StationPacer();
    pacer.look(400_000, 10, 0);
    expect(pacer.heldRate()).toBe(5);
    expect(pacer.look(0, 10, 5_000)).toBe("hold");
    expect(pacer.look(0, 10, 6_000)).toBe("up");
    expect(pacer.heldRate()).toBe(9);
    expect(pacer.look(0, 10, 12_000)).toBe("hold");
    expect(pacer.look(0, 10, 18_000)).toBe("up");
    expect(pacer.heldRate()).toBeNull();
  });

  it("doubles back up while no rate above it has fallen behind", () => {
    const pacer = new StationPacer();
    pacer.look(400_000, 10, 0);
    pacer.look(400_000, 10, 2_000);
    pacer.look(400_000, 10, 4_000);
    expect(pacer.heldRate()).toBe(1);
    // Keeping up at 2, the rate that last fell behind, clears what was known about it.
    const rates: (number | null)[] = [];
    for (let at = 16_000; at <= 40_000; at += 6_000) {
      pacer.look(0, 10, at);
      rates.push(pacer.heldRate());
    }
    expect(rates).toEqual([2, 4, 8, null, null]);
  });

  it("goes back to the rate before a rise that fell behind, and waits twice as long before trying it again", () => {
    const pacer = new StationPacer();
    pacer.look(400_000, 10, 0);
    pacer.look(0, 10, 6_000);
    expect(pacer.heldRate()).toBe(9);
    expect(pacer.look(400_000, 10, 9_000)).toBe("down");
    expect(pacer.heldRate()).toBe(5);
    expect(pacer.look(0, 10, 15_000)).toBe("up");
    expect(pacer.heldRate()).toBe(8);
    // 9 fell behind once, so trying it again waits 24 s rather than 12.
    expect(pacer.look(0, 10, 38_000)).toBe("hold");
    expect(pacer.look(0, 10, 39_000)).toBe("up");
    expect(pacer.heldRate()).toBe(9);
    expect(pacer.look(400_000, 10, 41_000)).toBe("down");
    expect(pacer.heldRate()).toBe(8);
    expect(pacer.look(0, 10, 41_000 + 29_000)).toBe("hold");
    expect(pacer.look(0, 10, 41_000 + 30_000)).toBe("up");
  });

  it("holds a fast Topic's samples to the rate, and lets a rewind through", () => {
    const pacer = new StationPacer();
    pacer.look(400_000, 10, 0);
    pacer.look(400_000, 10, 2_000);
    expect(pacer.heldRate()).toBe(2);

    const sent = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].filter(
      (validAt) => pacer.forwards("vessel.landing", validAt),
    );
    expect(sent).toEqual([0, 0.5, 1.0]);
    expect(pacer.forwards("vessel.landing", 0.2)).toBe(true);
    expect(pacer.forwards("vessel.flight", 1.0)).toBe(true);
  });
});

describe("HostPacer", () => {
  const behind = { loopLagMs: 400, frameMs: 16 };
  const fine = { loopLagMs: 5, frameMs: 16 };

  it("caps the mod only after the main screen has been behind three looks running", () => {
    const pacer = new HostPacer();
    expect(pacer.look(behind, 10, 0)).toBeUndefined();
    expect(pacer.look(fine, 10, 1_000)).toBeUndefined();
    expect(pacer.look(behind, 10, 2_000)).toBeUndefined();
    expect(pacer.look(behind, 10, 3_000)).toBeUndefined();
    expect(pacer.look(behind, 10, 4_000)).toBe(5);
  });

  it("lifts the cap back towards the rate that fell behind and withdraws it at the rate the mod sent before", () => {
    const pacer = new HostPacer();
    for (let at = 0; at <= 2_000; at += 1_000) pacer.look(behind, 10, at);
    expect(pacer.look(fine, 5, 7_000)).toBeUndefined();
    expect(pacer.look(fine, 5, 8_000)).toBe(9);
    expect(pacer.look(fine, 9, 19_000)).toBeUndefined();
    expect(pacer.look(fine, 9, 20_000)).toBeNull();
  });
});

describe("ArrivalBacklog", () => {
  it("reads how much longer the latest frame took than the quickest, whatever the clocks say", () => {
    const backlog = new ArrivalBacklog();
    expect(backlog.backlogMs()).toBe(0);
    backlog.note(1_000, 51_000);
    backlog.note(2_000, 52_010);
    backlog.note(3_000, 53_900);
    expect(backlog.backlogMs()).toBe(900);
  });
});
