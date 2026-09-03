import { describe, expect, it } from "vitest";
import {
  byArrivalAt,
  deliveryFor,
  revealedReceipts,
  revealUtFor,
  separationFor,
  type Vantage,
} from "./reveal";
import type { CommsMessage } from "./types";

const GROUND: Vantage = { seat: "mission-control", vantageId: "ksc" };
const ABOARD: Vantage = { seat: "pilot", vantageId: "vessel:abc" };
/** A second command centre, elsewhere. Same seat, different vantage. */
const FAR_CENTRE: Vantage = {
  seat: "mission-control",
  vantageId: "vessel:dsn-woomera",
};

function msg(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    authorStationKey: "key-1",
    authorName: "KSC",
    authorSeat: "mission-control",
    authorVantageId: "ksc",
    sentUt: 1000,
    oneWaySeconds: 240,
    kind: "text",
    body: "go for staging",
    receivedAtMs: 0,
    readBy: [],
    ...over,
  };
}

const fromPilot = (over: Partial<CommsMessage> = {}) =>
  msg({ authorSeat: "pilot", authorVantageId: "vessel:abc", ...over });

describe("separationFor", () => {
  it("puts two participants at one vantage at no distance", () => {
    // A station relays its host's frames verbatim, so it reads at the host's
    // vantage: host and station are genuinely co-located.
    expect(separationFor(msg(), GROUND)).toEqual({
      kind: "co-located",
      seconds: 0,
    });
  });

  it("puts a pilot one light-time from the ground", () => {
    expect(separationFor(msg(), ABOARD)).toEqual({
      kind: "light-time",
      seconds: 240,
    });
  });

  it("puts two pilots on ONE craft at no distance", () => {
    expect(separationFor(fromPilot(), ABOARD)).toEqual({
      kind: "co-located",
      seconds: 0,
    });
  });

  it("refuses to claim two pilots on DIFFERENT craft are co-located", () => {
    // Commcast is a broadcast and must generalise to several craft. Reading
    // the seat as "one active vessel, so they are together" is exactly the
    // assumption a second craft breaks.
    expect(
      separationFor(fromPilot({ authorVantageId: "vessel:xyz" }), ABOARD),
    ).toEqual({ kind: "unmeasured" });
  });

  it("uses the published pair matrix in preference to anything derived", () => {
    const pairs = new Map([["ksc", new Map([["vessel:abc", 137]])]]);
    expect(separationFor(msg(), ABOARD, pairs)).toEqual({
      kind: "light-time",
      seconds: 137,
    });
  });

  it("resolves a centre pair the seat rule cannot reach", () => {
    const pairs = new Map([["ksc", new Map([["vessel:dsn-woomera", 12]])]]);
    expect(separationFor(msg(), FAR_CENTRE, pairs)).toEqual({
      kind: "light-time",
      seconds: 12,
    });
  });

  it("refuses to claim two command centres at different vantages are co-located", () => {
    /*
     * The seat axis alone would say zero here, and it would be wrong: the
     * number that answers this is the pairwise centre delay the mod computes
     * and no channel publishes.
     */
    expect(separationFor(msg(), FAR_CENTRE)).toEqual({ kind: "unmeasured" });
  });

  it("reads a single unnamed centre as one centre rather than as two", () => {
    // Before the first frame lands nobody has a vantage id. Inventing a
    // separation from that absence would put every fresh page load behind an
    // imaginary delay.
    expect(
      separationFor(msg({ authorVantageId: undefined }), {
        seat: "mission-control",
      }),
    ).toEqual({ kind: "co-located", seconds: 0 });
  });

  it("reports no path across seats when the author had none", () => {
    expect(separationFor(msg({ oneWaySeconds: null }), ABOARD)).toEqual({
      kind: "no-path",
    });
  });

  it("treats a measured zero as a real zero, not as an absence", () => {
    expect(separationFor(msg({ oneWaySeconds: 0 }), ABOARD)).toEqual({
      kind: "light-time",
      seconds: 0,
    });
  });
});

describe("revealUtFor", () => {
  it("reveals at the send instant for a reader at the author's own vantage", () => {
    expect(revealUtFor(msg(), GROUND)).toBe(1000);
  });

  it("adds the frozen separation for a reader at the other seat", () => {
    expect(revealUtFor(msg(), ABOARD)).toBe(1240);
  });

  it("is a one-way crossing, never a round trip", () => {
    // The regression this exists for: gating on the reader's
    // `confirmedEdgeUt()` (already `utNow - 240` at a delayed seat) would put
    // the reveal at 1000 + 2 x 240. Nothing here may reach 1480.
    expect(revealUtFor(msg(), ABOARD)).toBe(1000 + 240);
  });

  it("never delivers across seats with no path home", () => {
    expect(revealUtFor(msg({ oneWaySeconds: null }), ABOARD)).toBeNull();
  });

  it("still shows a no-path message at the author's own vantage", () => {
    // A lost link home does not stop two people at one centre talking.
    expect(revealUtFor(msg({ oneWaySeconds: null }), GROUND)).toBe(1000);
  });
});

describe("deliveryFor", () => {
  it("holds a message that has not landed yet", () => {
    expect(deliveryFor(msg(), ABOARD, 1100)).toEqual({
      state: "in-transit",
      revealUt: 1240,
      transitSeconds: 240,
      separation: "light-time",
    });
  });

  it("releases it exactly at the reveal instant, not after", () => {
    expect(deliveryFor(msg(), ABOARD, 1240).state).toBe("revealed");
  });

  it("marks a no-path message unsent rather than holding it forever", () => {
    expect(deliveryFor(msg({ oneWaySeconds: null }), ABOARD, 1e9)).toEqual({
      state: "no-path",
    });
  });

  it("delivers an unmeasured centre pair rather than losing it, and says so", () => {
    // Holding forever would black-hole a message the physics says CAN arrive;
    // delivering it silently would imply a measured zero. It arrives, tagged.
    expect(deliveryFor(msg(), FAR_CENTRE, 1000)).toEqual({
      state: "revealed",
      revealUt: 1000,
      transitSeconds: 0,
      separation: "unmeasured",
    });
  });
});

describe("revealedReceipts", () => {
  const read = msg({
    readBy: [
      {
        stationKey: "pilot-1",
        seat: "pilot",
        vantageId: "vessel:abc",
        atUt: 1300,
      },
    ],
  });

  it("delays a read receipt back across the same separation", () => {
    expect(revealedReceipts(read, GROUND, 1400)).toHaveLength(0);
    expect(revealedReceipts(read, GROUND, 1540)).toHaveLength(1);
  });

  it("shows a receipt immediately at the reader's own vantage", () => {
    expect(revealedReceipts(read, ABOARD, 1300)).toHaveLength(1);
  });
});

describe("byArrivalAt", () => {
  it("orders by when each message landed here, not when it was spoken", () => {
    // Ground speaks first at UT 1000 but is 240 s away; the pilot speaks at
    // 1100 and is aboard. At the pilot's seat their own message lands first,
    // and inserting the ground's above it later would rewrite a thread that
    // has already been read.
    const g = msg({ id: "g", sentUt: 1000, receivedAtMs: 1 });
    const p = fromPilot({ id: "p", sentUt: 1100, receivedAtMs: 2 });
    expect([g, p].sort(byArrivalAt(ABOARD)).map((m) => m.id)).toEqual([
      "p",
      "g",
    ]);
  });

  it("gives the two seats genuinely different threads", () => {
    const g = msg({ id: "g", sentUt: 1000, receivedAtMs: 1 });
    const p = fromPilot({ id: "p", sentUt: 1100, receivedAtMs: 2 });
    const pair = [g, p];
    expect(
      pair
        .slice()
        .sort(byArrivalAt(GROUND))
        .map((m) => m.id),
    ).toEqual(["g", "p"]);
    expect(
      pair
        .slice()
        .sort(byArrivalAt(ABOARD))
        .map((m) => m.id),
    ).toEqual(["p", "g"]);
  });

  it("keeps a no-path message at the end rather than dropping it", () => {
    const ok = msg({ id: "a", sentUt: 1000, receivedAtMs: 1 });
    const lost = msg({
      id: "b",
      sentUt: 900,
      oneWaySeconds: null,
      receivedAtMs: 2,
    });
    expect([lost, ok].sort(byArrivalAt(ABOARD)).map((m) => m.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
