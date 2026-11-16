import { value } from "@ksp-gonogo/sitrep-sdk";
/**
 * Group membership as a value built from the changes that have reached this
 * vantage, each counting from the instant the mod delivered it here.
 */
import { describe, expect, it } from "vitest";
import { groupsAt, groupWith, messageText } from "./groups";
import type { CommcastLogSnapshot, CommsMessage } from "./types";
import { EMPTY_COMMCAST_LOG } from "./types";

const KSC = "ksc";
const NEAR = "vessel:near";
const FAR = "vessel:far";

function change(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "c1",
    groupId: "g1",
    to: [KSC, NEAR],
    from: KSC,
    authorStationKey: "ksc-1",
    authorName: "Kennedy",
    authorSeat: "mission-control",
    sentUt: value("ut", 100),
    lastSentUt: value("ut", 100),
    attempts: 1,
    separationSeconds: value("s", 3),
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
      outbox: [{ msg: change(), acks: [], deliveries: [] }],
    });
    expect(groupsAt(snap, value("ut", 100)).get("g1")).toEqual([KSC, NEAR]);
  });

  it("does not know a change made elsewhere until it has arrived here", () => {
    // Added at the ground at UT 200, delivered to the far craft nine seconds later.
    const addFar = change({
      id: "c2",
      sentUt: value("ut", 200),
      lastSentUt: value("ut", 200),
      to: [FAR, KSC, NEAR],
      members: [FAR, KSC, NEAR],
      added: [FAR],
      arrivedUt: value("ut", 209),
    });
    const snap = held({ pending: [addFar] });
    expect(groupsAt(snap, value("ut", 208.9)).has("g1")).toBe(false);
    expect(groupsAt(snap, value("ut", 209)).get("g1")).toEqual([
      KSC,
      FAR,
      NEAR,
    ]);
  });

  it("is the union of every change that has landed, whatever order they landed in", () => {
    const opened = change({ arrivedUt: value("ut", 103) });
    const grown = change({
      id: "c2",
      from: NEAR,
      sentUt: value("ut", 150),
      lastSentUt: value("ut", 150),
      to: [FAR, KSC, NEAR],
      members: [FAR, KSC, NEAR],
      added: [FAR],
      arrivedUt: value("ut", 153),
    });
    const snap = held({ inbox: [grown, opened] });
    expect(groupsAt(snap, value("ut", 1000)).get("g1")).toEqual([
      KSC,
      FAR,
      NEAR,
    ]);
  });

  it("reads words as words, not as membership", () => {
    const text = change({ kind: "text", members: undefined, body: "hi" });
    expect(groupsAt(held({ inbox: [text] }), value("ut", 1000)).size).toBe(0);
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
