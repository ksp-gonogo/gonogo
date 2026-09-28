/**
 * Group threads, not one log under a filter.
 *
 * A thread is a group: identified by the group's id rather than by its ends or
 * by direction, named for the group's other members as this vantage knows
 * them, and the one with something still crossing is the one an operator wants
 * first.
 */
import { describe, expect, it } from "vitest";
import type { Vantage } from "./reveal";
import { counterpartiesOf, threadFor, threadsOf } from "./threads";
import type { CommsMessage, OutboundMessage } from "./types";
import type { CommcastFeed } from "./useCommcastFeed";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";

const HERE: Vantage = { seat: "mission-control", vantageId: KSC };

function msg(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    groupId: "ares",
    to: [KSC, ARES],
    from: KSC,
    authorStationKey: "ksc-1",
    authorName: "Kennedy Flight",
    authorSeat: "mission-control",
    sentUt: 0,
    lastSentUt: 0,
    attempts: 1,
    separationSeconds: 240,
    kind: "text",
    body: "body",
    ...over,
  };
}

function out(over: Partial<CommsMessage> = {}): OutboundMessage {
  return { msg: msg(over), acks: [], neverLeft: false };
}

function feed(over: Partial<CommcastFeed> = {}): CommcastFeed {
  return { log: [], outbound: [], groups: new Map(), ...over };
}

describe("counterpartiesOf", () => {
  it("files this screen's OWN words under the others they were sent to", () => {
    expect(counterpartiesOf({ msg: msg(), out: out() }, HERE)).toEqual([ARES]);
  });

  it("files something heard under whoever said it", () => {
    const heard = msg({ from: ARES, to: [KSC, ARES], authorName: "Jeb" });
    expect(counterpartiesOf({ msg: heard }, HERE)).toEqual([ARES]);
  });

  it("leaves this vantage out of a group it is a member of", () => {
    const heard = msg({ from: ARES, to: [KSC, WOOMERA, ARES] });
    expect(counterpartiesOf({ msg: heard }, HERE)).toEqual([WOOMERA, ARES]);
  });
});

describe("threadsOf", () => {
  it("keeps two groups on one screen separate", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES }) },
          {
            msg: msg({
              id: "b",
              groupId: "woomera",
              from: WOOMERA,
              to: [KSC, WOOMERA],
            }),
          },
        ],
      }),
      HERE,
    );
    expect(threads.map((t) => t.key)).toEqual(["woomera", "ares"]);
    expect(threads.map((t) => t.with)).toEqual([[WOOMERA], [ARES]]);
  });

  it("joins everything said in one group into one thread, whoever said it", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES }) },
          { msg: msg({ id: "b" }), out: out({ id: "b" }) },
        ],
      }),
      HERE,
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].entries.map((e) => e.msg.id)).toEqual(["a", "b"]);
  });

  it("keeps two groups with the SAME members apart, because a group is its id", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES }) },
          { msg: msg({ id: "b", groupId: "ares-again", from: ARES }) },
        ],
      }),
      HERE,
    );
    expect(threads).toHaveLength(2);
  });

  it("names a thread for the group's members as they stand here, not as one message was addressed", () => {
    // The first message went out before Woomera was added; the group has grown since and the thread says so.
    const threads = threadsOf(
      feed({
        log: [{ msg: msg({ id: "a", from: ARES }) }],
        groups: new Map([["ares", [ARES, KSC, WOOMERA]]]),
      }),
      HERE,
    );
    expect(threads[0].with).toEqual([ARES, WOOMERA]);
  });

  it("puts the most recent group first and leaves each thread in landing order", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES, body: "first" }) },
          {
            msg: msg({
              id: "b",
              groupId: "woomera",
              from: WOOMERA,
              to: [KSC, WOOMERA],
            }),
          },
          { msg: msg({ id: "c", from: ARES, body: "latest" }) },
        ],
      }),
      HERE,
    );
    expect(threads.map((t) => t.key)).toEqual(["ares", "woomera"]);
    expect(threads[0].entries.map((e) => e.msg.body)).toEqual([
      "first",
      "latest",
    ]);
    expect(threads[0].preview).toBe("latest");
  });

  it("ranks a group with words still crossing above every settled one", () => {
    const threads = threadsOf(
      feed({
        log: [
          {
            msg: msg({
              id: "a",
              groupId: "woomera",
              from: WOOMERA,
              to: [KSC, WOOMERA],
            }),
          },
        ],
        outbound: [out({ id: "b", body: "still out" })],
      }),
      HERE,
    );
    expect(threads.map((t) => t.key)).toEqual(["ares", "woomera"]);
    expect(threads[0].outbound).toHaveLength(1);
    expect(threads[0].preview).toBe("still out");
  });

  it("previews a membership change in words", () => {
    const threads = threadsOf(
      feed({
        log: [
          {
            msg: {
              ...msg({
                from: ARES,
                kind: "members",
                members: [ARES, KSC, WOOMERA],
                added: [WOOMERA],
              }),
              body: undefined,
            },
          },
        ],
      }),
      HERE,
      (id) => (id === WOOMERA ? "Woomera Range" : id),
    );
    expect(threads[0].preview).toBe("added Woomera Range");
  });
});

describe("threadFor", () => {
  it("finds a held thread by its group", () => {
    const threads = threadsOf(
      feed({ log: [{ msg: msg({ from: ARES }) }] }),
      HERE,
    );
    expect(threadFor(threads, "ares", []).entries).toHaveLength(1);
  });

  it("gives an empty thread for a group nothing has been said in yet", () => {
    // A group just opened, or one only heard on the radio. It has to render as itself.
    const thread = threadFor([], "fresh", [ARES]);
    expect(thread.key).toBe("fresh");
    expect(thread.with).toEqual([ARES]);
    expect(thread.entries).toEqual([]);
    expect(thread.outbound).toEqual([]);
  });

  it("names an empty thread from the group's membership where it has reached here", () => {
    const thread = threadFor(
      [],
      "fresh",
      [ARES],
      new Map([["fresh", [ARES, KSC, WOOMERA]]]),
      HERE,
    );
    expect(thread.with).toEqual([ARES, WOOMERA]);
  });
});
