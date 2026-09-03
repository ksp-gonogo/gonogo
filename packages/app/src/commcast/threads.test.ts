/**
 * Conversations, not one log under a filter.
 *
 * The grouping is what replaced the recipient dropdown, so what these assert
 * is the claim the dropdown got wrong: two correspondences on one screen are
 * separate, they are identified by their ENDS rather than by direction, and the
 * one with something still crossing is the one an operator wants first.
 */
import { describe, expect, it } from "vitest";
import type { Vantage } from "./reveal";
import { counterpartiesOf, threadFor, threadKeyOf, threadsOf } from "./threads";
import type { CommsMessage, OutboundMessage } from "./types";
import type { CommcastFeed } from "./useCommcastFeed";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";

const HERE: Vantage = { seat: "mission-control", vantageId: KSC };

function msg(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    to: [ARES],
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
  return { log: [], outbound: [], ...over };
}

describe("threadKeyOf", () => {
  it("identifies a thread by its ends, in either order", () => {
    expect(threadKeyOf([ARES, WOOMERA])).toBe(threadKeyOf([WOOMERA, ARES]));
  });

  it("keeps two different sets apart", () => {
    expect(threadKeyOf([ARES])).not.toBe(threadKeyOf([ARES, WOOMERA]));
  });
});

describe("counterpartiesOf", () => {
  it("files this screen's OWN words under who they were sent to", () => {
    expect(counterpartiesOf({ msg: msg(), out: out() }, HERE)).toEqual([ARES]);
  });

  it("files something heard under whoever said it", () => {
    const heard = msg({ from: ARES, to: [KSC], authorName: "Jeb" });
    expect(counterpartiesOf({ msg: heard }, HERE)).toEqual([ARES]);
  });

  it("leaves this vantage out of a thread it is one end of", () => {
    // A message naming this screen AND somebody else is a conversation with
    // that somebody else, not with itself.
    const heard = msg({ from: ARES, to: [KSC, WOOMERA] });
    expect(counterpartiesOf({ msg: heard }, HERE)).toEqual([ARES, WOOMERA]);
  });

  it("still files an own message correctly before the vantage has landed", () => {
    /*
     * The state every fresh page load is in for its first frames. Deciding by
     * comparing `from` against the local vantage would read every message this
     * screen sent as one it had received from itself, and file the whole outbox
     * under its own address.
     */
    const nowhere: Vantage = { seat: "mission-control" };
    expect(counterpartiesOf({ msg: msg(), out: out() }, nowhere)).toEqual([
      ARES,
    ]);
  });
});

describe("threadsOf", () => {
  it("keeps two correspondences on one screen separate", () => {
    /*
     * The dropdown's implication, refuted. What the craft said and what
     * Woomera said were never one transcript with a lens over it.
     */
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES, to: [KSC] }) },
          { msg: msg({ id: "b", from: WOOMERA, to: [KSC] }) },
        ],
      }),
      HERE,
    );
    expect(threads.map((t) => t.with)).toEqual([[WOOMERA], [ARES]]);
    expect(threads.map((t) => t.entries.length)).toEqual([1, 1]);
  });

  it("joins both directions of one correspondence into one thread", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES, to: [KSC] }) },
          { msg: msg({ id: "b" }), out: out({ id: "b" }) },
        ],
      }),
      HERE,
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].with).toEqual([ARES]);
    expect(threads[0].entries.map((e) => e.msg.id)).toEqual(["a", "b"]);
  });

  it("puts the most recent conversation first and leaves each thread in landing order", () => {
    const threads = threadsOf(
      feed({
        log: [
          { msg: msg({ id: "a", from: ARES, to: [KSC], body: "first" }) },
          { msg: msg({ id: "b", from: WOOMERA, to: [KSC] }) },
          { msg: msg({ id: "c", from: ARES, to: [KSC], body: "latest" }) },
        ],
      }),
      HERE,
    );
    expect(threads.map((t) => t.with)).toEqual([[ARES], [WOOMERA]]);
    expect(threads[0].entries.map((e) => e.msg.body)).toEqual([
      "first",
      "latest",
    ]);
    expect(threads[0].preview).toBe("latest");
  });

  it("ranks a conversation with words still crossing above every settled one", () => {
    // Something is happening there, which is what an operator scanning an
    // inbox is looking for.
    const threads = threadsOf(
      feed({
        log: [{ msg: msg({ id: "a", from: WOOMERA, to: [KSC] }) }],
        outbound: [out({ id: "b", body: "still out" })],
      }),
      HERE,
    );
    expect(threads.map((t) => t.with)).toEqual([[ARES], [WOOMERA]]);
    expect(threads[0].outbound).toHaveLength(1);
    expect(threads[0].preview).toBe("still out");
  });

  it("names the mode of a message with no words to preview", () => {
    const threads = threadsOf(
      feed({
        log: [
          {
            msg: {
              ...msg({ from: ARES, to: [KSC], kind: "audio" }),
              body: undefined,
            },
          },
        ],
      }),
      HERE,
    );
    expect(threads[0].preview).toBe("audio");
  });
});

describe("threadFor", () => {
  it("finds a held conversation whichever order its ends are given in", () => {
    const threads = threadsOf(
      feed({ log: [{ msg: msg({ from: ARES, to: [KSC, WOOMERA] }) }] }),
      HERE,
    );
    expect(threadFor(threads, [WOOMERA, ARES]).entries).toHaveLength(1);
  });

  it("gives an empty conversation for ends nothing has been said to yet", () => {
    // A recipient just chosen out of the picker. It has to render as itself,
    // because the operator is looking at the box they are about to type into.
    const thread = threadFor([], [ARES]);
    expect(thread.with).toEqual([ARES]);
    expect(thread.entries).toEqual([]);
    expect(thread.outbound).toEqual([]);
  });
});
