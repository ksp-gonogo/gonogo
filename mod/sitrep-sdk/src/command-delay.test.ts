import { describe, expect, it } from "vitest";
import {
  classifyRetained,
  currentMode,
  deriveInFlight,
  latchForward,
} from "./command-delay";
import { value } from "./unit-system/value";

const entry = (over: Partial<import("./command-delay").PendingEntry> = {}) => ({
  id: "r1",
  command: "kos.run",
  label: "boot",
  topic: "kos/7",
  vantage: "ksc",
  // An instant, not an interval. Built as `value("s", ...)` until the affine
  // rules landed, which meant every test here exercised duration + duration
  // and none of them exercised the instant + duration the module actually does.
  dispatchedAt: value("ut", 100),
  oneWaySeconds: value("s", 4),
  ...over,
});

describe("currentMode", () => {
  it("null oneWay is no-path (never 0)", () => {
    expect(currentMode({ oneWaySeconds: null })).toBe("no-path");
  });
  it("<=1s is live, >1s is staged", () => {
    expect(currentMode({ oneWaySeconds: value("s", 0.5) })).toBe("live");
    expect(currentMode({ oneWaySeconds: value("s", 4) })).toBe("staged");
  });
  it("undefined commsDelay is no-path", () => {
    expect(currentMode(undefined)).toBe("no-path");
  });
});

describe("deriveInFlight phases (nowUt vs dispatchedAt+oneWay/2*oneWay)", () => {
  it("before reach = in-transit, eta counts to reach", () => {
    const [c] = deriveInFlight([entry()], 102); // reach at 104, reply at 108
    expect(c.predictedPhase).toBe("in-transit");
    expect(c.reachEtaSeconds).toBe(2);
    expect(c.replyEtaSeconds).toBe(6);
  });
  it("between reach and reply = awaiting-reply", () => {
    expect(deriveInFlight([entry()], 106)[0].predictedPhase).toBe(
      "awaiting-reply",
    );
  });
  it("past reply = due", () => {
    expect(deriveInFlight([entry()], 109)[0].predictedPhase).toBe("due");
  });
});

describe("classifyRetained", () => {
  const e = entry();

  it("path dropped during [dispatch, reply] => lost", () => {
    const c = classifyRetained({
      entry: e,
      nowUt: 106,
      present: true,
      pathConnectedDuring: () => false,
    });
    expect(c.predictedPhase).toBe("lost");
  });
  it("past reply + margin, still nothing => overdue", () => {
    const c = classifyRetained({
      entry: e,
      nowUt: 120,
      present: true,
      overdueMarginSeconds: 5,
      pathConnectedDuring: () => true,
    });
    expect(c.predictedPhase).toBe("overdue");
  });
  it("aged out of queue but path was fine and within window => due (assumed arrived)", () => {
    const c = classifyRetained({
      entry: e,
      nowUt: 109,
      present: false,
      pathConnectedDuring: () => true,
    });
    expect(c.predictedPhase).toBe("due");
  });
  it("defaults pathConnectedDuring to always-connected when omitted", () => {
    const c = classifyRetained({ entry: e, nowUt: 106, present: true });
    expect(c.predictedPhase).toBe("awaiting-reply");
  });

  /**
   * The reply instant is the dispatch offset by TWO one-way legs, and the
   * overdue margin is a duration added to that instant, not an instant of its
   * own. Dispatch 100, leg 4, margin 5: reply at 108, overdue past 113.
   *
   * Pinned at the boundary because that is where the two ways of getting this
   * wrong show up: one leg instead of two moves it to 109, and treating the
   * margin as a UT moves it to 5.
   */
  it("goes overdue only past dispatch + two legs + the margin", () => {
    const overdueAt = (nowUt: number) =>
      classifyRetained({
        entry: e,
        nowUt,
        present: true,
        overdueMarginSeconds: 5,
      }).predictedPhase;

    expect(overdueAt(112.9)).not.toBe("overdue");
    expect(overdueAt(113)).not.toBe("overdue");
    expect(overdueAt(113.1)).toBe("overdue");
  });

  it("reports the two etas as intervals from now to each instant", () => {
    const [c] = deriveInFlight([e], 100);
    expect(c.reachEtaSeconds).toBe(4);
    expect(c.replyEtaSeconds).toBe(8);
  });
});

describe("latchForward", () => {
  it("keeps the more-advanced phase across a transient backward blip", () => {
    const memory = new Map<string, import("./command-delay").InFlightCommand>();
    const first = latchForward(deriveInFlight([entry()], 106), memory); // awaiting-reply
    expect(first[0].predictedPhase).toBe("awaiting-reply");

    // A judder briefly reports nowUt < reachUt again, the latch must not
    // regress the observed phase back to in-transit.
    const blip = latchForward(deriveInFlight([entry()], 103), memory);
    expect(blip[0].predictedPhase).toBe("awaiting-reply");
  });

  it("forgets ids no longer present in the current item set", () => {
    const memory = new Map<string, import("./command-delay").InFlightCommand>();
    latchForward(deriveInFlight([entry()], 106), memory);
    expect(memory.has("r1")).toBe(true);
    latchForward([], memory);
    expect(memory.has("r1")).toBe(false);
  });

  it("advances forward normally when phase progresses", () => {
    const memory = new Map<string, import("./command-delay").InFlightCommand>();
    latchForward(deriveInFlight([entry()], 102), memory); // in-transit
    const advanced = latchForward(deriveInFlight([entry()], 109), memory); // due
    expect(advanced[0].predictedPhase).toBe("due");
  });
});
