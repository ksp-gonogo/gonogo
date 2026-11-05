import { describe, expect, it } from "vitest";
import type { PendingEntry } from "./command-delay";
import { expectedAtCraft, valueCommandState } from "./command-value";
import { value } from "./unit-system/value";

function entry(
  command: string,
  sentAtUt: number,
  commandedValue: number,
  over: Partial<PendingEntry> = {},
): PendingEntry {
  return {
    id: `e-${sentAtUt}`,
    clientRequestId: `c-${sentAtUt}`,
    command,
    label: "",
    topic: "",
    vantage: "ground:Kerbin: KSC",
    dispatchedAt: value("ut", sentAtUt),
    oneWaySeconds: value("s", 27),
    commandedValue,
    ...over,
  } as PendingEntry;
}

const THROTTLE = "vessel.control.setThrottle";
const ut = (n: number) => value("ut", n);
const ONE_WAY = value("s", 27);

describe("expectedAtCraft", () => {
  it("is the last command to have reached the craft, in the order they arrive", () => {
    const inFlight = [
      { value: 1, sentAt: ut(0), arrivesAt: ut(27) },
      { value: 0, sentAt: ut(5), arrivesAt: ut(32) },
    ];
    expect(expectedAtCraft(inFlight, 0.2, ut(10))).toBe(0.2);
    expect(expectedAtCraft(inFlight, 0.2, ut(28))).toBe(1);
    expect(expectedAtCraft(inFlight, 0.2, ut(33))).toBe(0);
  });

  it("takes a command held at a relay at its predicted arrival, not its send time plus the delay", () => {
    const inFlight = [
      { value: 1, sentAt: ut(0), arrivesAt: ut(60) },
      { value: 0.5, sentAt: ut(5), arrivesAt: ut(32) },
    ];
    expect(expectedAtCraft(inFlight, 0, ut(40))).toBe(0.5);
    expect(expectedAtCraft(inFlight, 0, ut(61))).toBe(1);
  });
});

describe("valueCommandState", () => {
  it("commands the newest value any screen sent, and narrows to one part's commands", () => {
    const queue = {
      pending: [
        entry("robotics.rotor.setRpmLimit", 0, 350, { topic: "101" }),
        entry("robotics.rotor.setRpmLimit", 5, 340, { topic: "101" }),
        entry("robotics.rotor.setRpmLimit", 6, 120, { topic: "202" }),
      ],
    };
    const state = valueCommandState(
      "robotics.rotor.setRpmLimit",
      { received: 300, matches: (e) => e.topic === "101" },
      queue,
      ONE_WAY,
      ut(30),
    );
    expect(state.commanded).toBe(340);
    expect(state.expected).toBe(350);
  });

  it("follows this screen's own value until the queue lists one newer, and the reading once nothing is in flight", () => {
    const own = { value: 0.4, at: ut(10) };
    expect(
      valueCommandState(
        THROTTLE,
        { received: 0, own },
        { pending: [] },
        ONE_WAY,
        ut(11),
      ).commanded,
    ).toBe(0.4);
    expect(
      valueCommandState(
        THROTTLE,
        { received: 0, own },
        { pending: [entry(THROTTLE, 12, 0.9)] },
        ONE_WAY,
        ut(13),
      ).commanded,
    ).toBe(0.9);
    expect(
      valueCommandState(
        THROTTLE,
        { received: 0.4, own },
        { pending: [] },
        ONE_WAY,
        ut(80),
      ).commanded,
    ).toBe(0.4);
    expect(
      valueCommandState(
        THROTTLE,
        { received: 0.1 },
        { pending: [] },
        ONE_WAY,
        ut(80),
      ).commanded,
    ).toBe(0.1);
  });
});
