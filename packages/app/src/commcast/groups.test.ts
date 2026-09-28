/**
 * Group membership as a value that reaches each vantage one light-time after
 * the change was made there.
 */
import { describe, expect, it } from "vitest";
import { groupsAt, groupWith, messageText } from "./groups";
import type { SeparationMatrix, Vantage } from "./reveal";
import type { CommcastLogSnapshot, CommsMessage } from "./types";
import { EMPTY_COMMCAST_LOG } from "./types";

const KSC = "ksc";
const NEAR = "vessel:near";
const FAR = "vessel:far";

const PAIRS: SeparationMatrix = new Map([
  [
    KSC,
    new Map([
      [NEAR, 3],
      [FAR, 9],
    ]),
  ],
  [
    NEAR,
    new Map([
      [KSC, 3],
      [FAR, 7],
    ]),
  ],
  [
    FAR,
    new Map([
      [KSC, 9],
      [NEAR, 7],
    ]),
  ],
]);

const AT_KSC: Vantage = { seat: "mission-control", vantageId: KSC };
const AT_FAR: Vantage = { seat: "pilot", vantageId: FAR };

function change(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "c1",
    groupId: "g1",
    to: [KSC, NEAR],
    from: KSC,
    authorStationKey: "ksc-1",
    authorName: "Kennedy",
    authorSeat: "mission-control",
    sentUt: 100,
    lastSentUt: 100,
    attempts: 1,
    separationSeconds: 3,
    kind: "members",
    members: [KSC, NEAR],
    added: [NEAR],
    ...over,
  };
}

function held(over: Partial<CommcastLogSnapshot>): CommcastLogSnapshot {
  return { ...EMPTY_COMMCAST_LOG, ...over };
}

describe("groupsAt", () => {
  it("knows a group its own vantage opened from the instant it was opened", () => {
    const snap = held({
      outbox: [{ msg: change(), acks: [], neverLeft: false }],
    });
    expect(groupsAt(snap, AT_KSC, 100, PAIRS).get("g1")).toEqual([KSC, NEAR]);
  });

  it("does not know a change made elsewhere until it has crossed to here", () => {
    // Added at the ground at UT 200; the far craft is nine seconds out.
    const addFar = change({
      id: "c2",
      sentUt: 200,
      lastSentUt: 200,
      to: [FAR, KSC, NEAR],
      members: [FAR, KSC, NEAR],
      added: [FAR],
    });
    const snap = held({ pending: [addFar] });
    expect(groupsAt(snap, AT_FAR, 208.9, PAIRS).has("g1")).toBe(false);
    expect(groupsAt(snap, AT_FAR, 209, PAIRS).get("g1")).toEqual([
      KSC,
      FAR,
      NEAR,
    ]);
  });

  it("is the union of every change that has landed, whatever order they landed in", () => {
    const opened = change();
    const grown = change({
      id: "c2",
      from: NEAR,
      sentUt: 150,
      lastSentUt: 150,
      to: [FAR, KSC, NEAR],
      members: [FAR, KSC, NEAR],
      added: [FAR],
    });
    const snap = held({ inbox: [grown, opened] });
    expect(groupsAt(snap, AT_KSC, 1000, PAIRS).get("g1")).toEqual([
      KSC,
      FAR,
      NEAR,
    ]);
  });

  it("never reaches a vantage with no path from where the change was made", () => {
    const cut: SeparationMatrix = new Map();
    const snap = held({ pending: [change({ separationSeconds: null })] });
    expect(groupsAt(snap, AT_FAR, 10_000, cut).size).toBe(0);
  });

  it("reads words as words, not as membership", () => {
    const text = change({ kind: "text", members: undefined, body: "hi" });
    expect(groupsAt(held({ inbox: [text] }), AT_KSC, 1000, PAIRS).size).toBe(0);
  });
});

describe("groupWith", () => {
  it("finds the group with exactly these members, so choosing them again reopens it", () => {
    const groups = new Map([
      ["g1", [KSC, NEAR]],
      ["g2", [FAR, KSC, NEAR]],
    ]);
    expect(groupWith(groups, [NEAR, KSC])).toBe("g1");
    expect(groupWith(groups, [KSC, FAR])).toBeUndefined();
  });
});

describe("messageText", () => {
  const names = (id: string) =>
    ({ [KSC]: "Kennedy", [NEAR]: "Near", [FAR]: "Far" })[id] ?? id;

  it("says a group was opened, with whom", () => {
    expect(messageText(change(), names)).toBe("opened with Near");
  });

  it("says who a later change added", () => {
    const grown = change({ members: [FAR, KSC, NEAR], added: [FAR] });
    expect(messageText(grown, names)).toBe("added Far");
  });

  it("reads a message's own words otherwise", () => {
    expect(
      messageText(change({ kind: "text", body: "go for burn" }), names),
    ).toBe("go for burn");
  });
});
