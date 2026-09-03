import { describe, expect, it } from "vitest";
import {
  classifyRetained,
  currentMode,
  deriveInFlight,
  latchForward,
  signalDelayPresentation,
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
  it("aged out of queue but path was fine and within the margin => due", () => {
    const c = classifyRetained({
      entry: e,
      nowUt: 109,
      present: false,
      pathConnectedDuring: () => true,
    });
    expect(c.predictedPhase).toBe("due");
  });

  /**
   * The mod ages an entry out at exactly `DispatchedAt + 2*OneWaySeconds`
   * (`ChannelEngine.PrunePendingUplinks`), so `present` is false for every
   * command that is LATE. Gating `overdue` on queue presence therefore made
   * the phase unreachable and read every unanswered command as an arrival.
   */
  it("goes overdue past reply + margin even once the queue has aged the entry out", () => {
    const c = classifyRetained({
      entry: e,
      nowUt: 120,
      present: false,
      acknowledged: false,
      overdueMarginSeconds: 5,
      pathConnectedDuring: () => true,
    });
    expect(c.predictedPhase).toBe("overdue");
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

describe("signalDelayPresentation", () => {
  const s = (n: number) => value("s", n);

  it("shows nothing when there is no measurable path", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: null, canQueue: true }),
    ).toBe("none");
  });

  it("shows nothing on a link with no delay to report", () => {
    // 0 is a real reading, not an absence: a dashboard at the pad. A chip
    // saying "one-way ~0 s" is noise, and neither is there anything to count.
    expect(
      signalDelayPresentation({ oneWaySeconds: s(0), canQueue: true }),
    ).toBe("none");
  });

  it("badges a delay too short to count down", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: s(0.4), canQueue: true }),
    ).toBe("badge");
  });

  it("hands a long delay to the strip", () => {
    expect(
      signalDelayPresentation({ oneWaySeconds: s(240), canQueue: true }),
    ).toBe("strip");
  });

  it("never asks for both", () => {
    // The property the whole function exists for: one reading of the delay,
    // never two shapes of the same number on one console.
    for (const oneWaySeconds of [0.01, 0.5, 1, 1.001, 12, 240, 4000]) {
      for (const canQueue of [true, false]) {
        for (const alwaysBadge of [true, false]) {
          const got = signalDelayPresentation({
            oneWaySeconds: s(oneWaySeconds),
            canQueue,
            alwaysBadge,
          });
          expect(["badge", "strip", "none"]).toContain(got);
        }
      }
    }
  });

  it("gives a read-only viewer neither reading at a long delay", () => {
    // It dispatches nothing, so there is no queue to draw, and a standing badge
    // would quote a cost it never pays.
    expect(
      signalDelayPresentation({ oneWaySeconds: s(240), canQueue: false }),
    ).toBe("none");
  });

  it("badges at any magnitude when the console cannot queue at all", () => {
    // Character-mode terminal: every keystroke goes on its own, so there is no
    // composed line for a strip to list however far away the craft is.
    expect(
      signalDelayPresentation({
        oneWaySeconds: s(240),
        canQueue: true,
        alwaysBadge: true,
      }),
    ).toBe("badge");
  });

  it("turns over on whatever boundary currentMode is using", () => {
    /*
     * Not a pin between two copies of a literal: there is one copy, and this
     * reads the boundary OFF `currentMode` rather than restating it. Whatever
     * `live` means today, that is what gets the badge, so a change to the
     * staging threshold moves both readings together and cannot leave a badge
     * beside a strip drawing the same number.
     */
    const live = [0.001, 0.5, 1].map(s);
    const staged = [1.001, 12, 240].map(s);
    for (const oneWaySeconds of live) {
      expect(currentMode({ oneWaySeconds })).toBe("live");
      expect(signalDelayPresentation({ oneWaySeconds, canQueue: true })).toBe(
        "badge",
      );
    }
    for (const oneWaySeconds of staged) {
      expect(currentMode({ oneWaySeconds })).toBe("staged");
      expect(signalDelayPresentation({ oneWaySeconds, canQueue: true })).toBe(
        "strip",
      );
    }
  });
});
