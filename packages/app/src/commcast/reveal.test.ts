import { describe, expect, it } from "vitest";
import {
  ackRevealUt,
  firstAckUtFor,
  isSettled,
  legOf,
  revealedAcks,
  revealUtFor,
  roundTripFor,
  sentArrivalUtFor,
  sentPhaseFor,
  separationBetween,
  separationFor,
  type Vantage,
} from "./reveal";
import type { CommsAck, CommsMessage, OutboundMessage } from "./types";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";

const GROUND: Vantage = { seat: "mission-control", vantageId: KSC };
const ABOARD: Vantage = { seat: "pilot", vantageId: ARES };

function msg(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    to: [ARES],
    from: KSC,
    authorStationKey: "key-1",
    authorName: "KSC",
    authorSeat: "mission-control",
    sentUt: 1000,
    lastSentUt: 1000,
    attempts: 1,
    separationSeconds: 240,
    kind: "text",
    body: "go for staging",
    ...over,
  };
}

function outbound(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return { msg: msg(), acks: [], neverLeft: false, ...over };
}

function ack(over: Partial<CommsAck> = {}): CommsAck {
  return {
    messageId: "m1",
    from: ARES,
    stationKey: "pilot-key",
    seat: "pilot",
    atUt: 1240,
    ...over,
  };
}

describe("separationBetween", () => {
  it("puts one vantage at no distance from itself", () => {
    // A station relays its host's frames verbatim, so it reads at the host's
    // vantage: host and station are genuinely co-located.
    expect(separationBetween(KSC, KSC, 240)).toEqual({
      kind: "co-located",
      seconds: 0,
    });
  });

  it("prefers the published pair matrix to anything derived", () => {
    const pairs = new Map([[KSC, new Map([[ARES, 90]])]]);
    expect(separationBetween(KSC, ARES, 240, pairs)).toEqual({
      kind: "light-time",
      seconds: 90,
    });
  });

  it("resolves a centre pair the seat axis alone cannot reach", () => {
    // Both ends are `mission-control`, so nothing but the published pair
    // separates them, and reading them as co-located would let two centres a
    // continent apart hear each other instantly.
    const pairs = new Map([[KSC, new Map([[WOOMERA, 12]])]]);
    expect(separationBetween(KSC, WOOMERA, null, pairs)).toEqual({
      kind: "light-time",
      seconds: 12,
    });
  });

  it("falls back to the caller's own figure for a pair the matrix misses", () => {
    expect(separationBetween(KSC, ARES, 240)).toEqual({
      kind: "light-time",
      seconds: 240,
    });
  });

  it("treats a measured zero as a real zero, not as an absence", () => {
    expect(separationBetween(KSC, ARES, 0)).toEqual({
      kind: "light-time",
      seconds: 0,
    });
  });

  it("reports no path when the fallback says there is none", () => {
    expect(separationBetween(KSC, ARES, null)).toEqual({ kind: "no-path" });
  });

  it("says a pair is unpublished rather than implying a measured zero", () => {
    expect(separationBetween(KSC, WOOMERA, undefined)).toEqual({
      kind: "unmeasured",
    });
  });

  it("reads a screen with no vantage yet as one vantage, not as two", () => {
    // Before the first frame lands nobody has an id at all, and inventing a
    // separation out of that absence would put every fresh page load behind an
    // imaginary delay.
    expect(separationBetween(undefined, undefined, undefined)).toEqual({
      kind: "co-located",
      seconds: 0,
    });
  });
});

describe("revealUtFor", () => {
  it("crosses once, never a round trip", () => {
    expect(revealUtFor(msg(), ABOARD)).toBe(1240);
  });

  it("reveals at the send instant for a reader at the author's own vantage", () => {
    expect(revealUtFor(msg(), GROUND)).toBe(1000);
  });

  it("measures from the LATEST attempt, so a resend really is a fresh journey", () => {
    expect(revealUtFor(msg({ lastSentUt: 4000 }), ABOARD)).toBe(4240);
  });

  it("never delivers when there was no path", () => {
    expect(revealUtFor(msg({ separationSeconds: null }), ABOARD)).toBeNull();
  });
});

describe("roundTripFor", () => {
  it("spans the two legs plus the shipped loss margin", () => {
    // Deliberately `classifyRetained`'s own geometry: reach, reply at twice
    // the separation, and `LOSS_MARGIN` (3 s) before the wait is given up.
    expect(roundTripFor(msg())).toEqual({
      reachUt: 1240,
      replyUt: 1480,
      overdueUt: 1483,
    });
  });

  it("has no geometry at all when the words never left", () => {
    expect(roundTripFor(msg({ separationSeconds: null }))).toBeNull();
  });

  it("collapses to the send instant when the recipient is alongside", () => {
    // Two participants at one vantage are ~0 apart, so the acknowledgement is
    // effectively instant. That falls out rather than being special-cased.
    expect(roundTripFor(msg({ separationSeconds: 0 }))?.replyUt).toBe(1000);
  });
});

describe("ackRevealUt", () => {
  it("delays an acknowledgement back across the same separation", () => {
    expect(ackRevealUt(ack(), msg(), GROUND)).toBe(1480);
  });

  it("shows one from a vantage alongside immediately", () => {
    expect(ackRevealUt(ack({ from: KSC }), msg(), GROUND)).toBe(1240);
  });
});

describe("revealedAcks", () => {
  const out = outbound({ acks: [ack()] });

  it("withholds one that has not got back yet", () => {
    expect(revealedAcks(out, GROUND, 1479)).toHaveLength(0);
  });

  it("counts it exactly at the instant it lands", () => {
    expect(revealedAcks(out, GROUND, 1480)).toHaveLength(1);
  });
});

describe("sentPhaseFor", () => {
  it("is on the outbound leg while it is still crossing", () => {
    expect(sentPhaseFor(outbound(), GROUND, 1100)).toBe("in-transit");
    expect(legOf("in-transit")).toBe("outbound");
  });

  it("is on the return leg once it has reached the recipient", () => {
    expect(sentPhaseFor(outbound(), GROUND, 1300)).toBe("awaiting-reply");
    expect(legOf("awaiting-reply")).toBe("return");
  });

  it("is due from the reply instant until the loss margin runs out", () => {
    expect(sentPhaseFor(outbound(), GROUND, 1480)).toBe("due");
    expect(sentPhaseFor(outbound(), GROUND, 1482)).toBe("due");
  });

  it("goes overdue once the margin has passed with nothing back", () => {
    expect(sentPhaseFor(outbound(), GROUND, 1483)).toBe("overdue");
  });

  it("is confirmed only once the acknowledgement has REACHED the author", () => {
    const out = outbound({ acks: [ack()] });
    // Recorded at 1240 at the far end; still crossing back at 1300.
    expect(sentPhaseFor(out, GROUND, 1300)).toBe("awaiting-reply");
    expect(sentPhaseFor(out, GROUND, 1480)).toBe("confirmed");
  });

  it("stays confirmed however late the clock runs on", () => {
    // The guard on the resend: a late acknowledgement must never flip a
    // confirmed message back to unconfirmed.
    expect(sentPhaseFor(outbound({ acks: [ack()] }), GROUND, 99_000)).toBe(
      "confirmed",
    );
  });

  it("calls a message that never left lost, not a long wait", () => {
    const out = outbound({
      msg: msg({ separationSeconds: null }),
      neverLeft: true,
    });
    expect(sentPhaseFor(out, GROUND, 1000)).toBe("lost");
  });
});

describe("isSettled", () => {
  it("keeps a travelling message in the queue and takes a finished one out", () => {
    expect(isSettled("in-transit")).toBe(false);
    expect(isSettled("awaiting-reply")).toBe(false);
    expect(isSettled("due")).toBe(false);
    expect(isSettled("confirmed")).toBe(true);
    expect(isSettled("overdue")).toBe(true);
    expect(isSettled("lost")).toBe(true);
  });
});

describe("sentArrivalUtFor", () => {
  it("holds the author's own words while the round trip is still running", () => {
    expect(sentArrivalUtFor(outbound(), GROUND, 1300)).toBeUndefined();
  });

  it("lands them the instant an acknowledgement gets back", () => {
    expect(sentArrivalUtFor(outbound({ acks: [ack()] }), GROUND, 1000)).toBe(
      1480,
    );
  });

  it("hands them back unconfirmed rather than losing them forever", () => {
    expect(sentArrivalUtFor(outbound(), GROUND, 1482)).toBeUndefined();
    expect(sentArrivalUtFor(outbound(), GROUND, 1483)).toBe(1483);
  });

  it("never waits past the give-up for an acknowledgement later still", () => {
    const out = outbound({ acks: [ack({ atUt: 9000 })] });
    expect(sentArrivalUtFor(out, GROUND, 9999)).toBe(1483);
  });

  it("shows words that never left at once, because the author is next to them", () => {
    const out = outbound({
      msg: msg({ separationSeconds: null }),
      neverLeft: true,
    });
    expect(sentArrivalUtFor(out, GROUND, 1000)).toBe(1000);
  });
});

describe("firstAckUtFor", () => {
  it("takes the nearest ear, not the first entry in the list", () => {
    const out = outbound({
      acks: [ack(), ack({ stationKey: "s2", from: KSC, atUt: 1010 })],
    });
    expect(firstAckUtFor(out, GROUND)).toBe(1010);
  });

  it("is undefined while nobody has answered", () => {
    expect(firstAckUtFor(outbound(), GROUND)).toBeUndefined();
  });
});

describe("separationFor", () => {
  it("resolves the reader's own distance from where it was spoken", () => {
    expect(separationFor(msg(), ABOARD)).toEqual({
      kind: "light-time",
      seconds: 240,
    });
  });
});
