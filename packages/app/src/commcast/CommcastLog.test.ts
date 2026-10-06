import { beforeEach, describe, expect, it } from "vitest";
import type { OutgoingAck } from "./CommcastLog";
import { CommcastLog, type CommcastTransmitter } from "./CommcastLog";
import { separationsTo } from "./reveal";
import type { CommsAck, CommsMessage } from "./types";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";

const AUTHOR = {
  stationKey: "ksc-1",
  name: "Kennedy Flight",
  seat: "mission-control" as const,
  vantageId: KSC,
};

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
}

function recorder() {
  const sent: CommsMessage[] = [];
  const acked: OutgoingAck[] = [];
  const transmitter: CommcastTransmitter = {
    transmit: (msg) => {
      sent.push(msg);
    },
    acknowledge: (ack) => {
      acked.push(ack);
    },
  };
  return { sent, acked, transmitter };
}

function makeLog(
  over: Partial<ConstructorParameters<typeof CommcastLog>[0]> = {},
) {
  return new CommcastLog({
    screenKey: "screen-a",
    storage: memoryStorage(),
    ...over,
  });
}

describe("CommcastLog, one vantage's own record", () => {
  let wire: ReturnType<typeof recorder>;
  let log: CommcastLog;

  beforeEach(() => {
    wire = recorder();
    log = makeLog({ transmitter: wire.transmitter });
    log.setVantage(KSC);
  });

  it("transmits what it is given, and keeps its own copy", () => {
    const msg = log.send(AUTHOR, {
      kind: "text",
      groupId: "g1",
      body: "go for the burn",
      to: [ARES],
      sentUt: 1000,
      separations: separationsTo(KSC, [ARES], 240),
    });
    expect(wire.sent).toEqual([msg]);
    expect(log.snapshot().outbox).toHaveLength(1);
    expect(log.snapshot().outbox[0].deliveries[0]?.neverLeft).toBe(false);
  });

  it("transmits NOTHING when there was no path, and says so", () => {
    /*
     * The mesh would deliver it over the internet in milliseconds, which is
     * exactly the faster-than-light channel the light-time model exists to
     * model away. The loss is real and the author is the only one who can see
     * it.
     */
    log.send(AUTHOR, {
      kind: "text",
      groupId: "g1",
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separations: separationsTo(KSC, [ARES], null),
    });
    expect(wire.sent).toHaveLength(0);
    expect(log.snapshot().outbox[0].deliveries[0]?.neverLeft).toBe(true);
  });

  it("keeps only what NAMES this vantage", () => {
    // Every frame passes every participant, because the star topology gives no
    // choice. Dropping other people's mail unread here is what makes two
    // vantages hold different sets rather than one set filtered at render time.
    const forMe = fromWire({ to: [KSC] });
    const forSomeoneElse = fromWire({ id: "m2", to: ["ground:woomera"] });
    expect(log.receiveTransmission(forMe)).toBe(true);
    expect(log.receiveTransmission(forSomeoneElse)).toBe(false);
    expect(log.snapshot().pending).toHaveLength(1);
  });

  it("holds an arrival rather than showing it, until it is released", () => {
    log.receiveTransmission(fromWire({ to: [KSC] }));
    expect(log.snapshot().inbox).toHaveLength(0);
    log.release("m1", {
      from: KSC,
      stationKey: "screen-a",
      seat: "mission-control",
    });
    expect(log.snapshot().inbox).toHaveLength(1);
    expect(log.snapshot().pending).toHaveLength(0);
  });

  it("acknowledges a message once it is in front of the operator", () => {
    log.receiveTransmission(fromWire({ to: [KSC] }));
    log.release("m1", {
      from: KSC,
      stationKey: "screen-a",
      seat: "mission-control",
    });
    expect(wire.acked).toEqual([
      {
        messageId: "m1",
        from: KSC,
        stationKey: "screen-a",
        seat: "mission-control",
      },
    ]);
  });

  it("does not answer a message spoken at its own vantage", () => {
    // A colleague at the same centre crossed nothing, and an instant answer would confirm words still on their way to the members who are far away.
    log.receiveTransmission(fromWire({ from: KSC, to: [KSC, ARES] }));
    log.release("m1", {
      from: KSC,
      stationKey: "screen-a",
      seat: "mission-control",
    });
    expect(log.snapshot().inbox).toHaveLength(1);
    expect(wire.acked).toEqual([]);
  });

  it("carries a membership change whole: the group, its members, and who came in", () => {
    const msg = log.send(AUTHOR, {
      kind: "members",
      groupId: "g7",
      to: [ARES, KSC],
      members: [ARES, KSC],
      added: [ARES],
      sentUt: 1000,
      separations: separationsTo(KSC, [ARES, KSC], 240),
    });
    expect(wire.sent).toEqual([msg]);
    expect(msg).toMatchObject({
      groupId: "g7",
      kind: "members",
      members: [ARES, KSC],
      added: [ARES],
    });
  });

  describe("the idempotent resend", () => {
    it("keeps the message id, so the recipient can dedupe on it", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        groupId: "g1",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separations: separationsTo(KSC, [ARES], 240),
      });
      log.resend(msg.id, [ARES], 2000, new Map([[ARES, 240]]));
      expect(wire.sent).toHaveLength(2);
      expect(wire.sent[1].id).toBe(msg.id);
    });

    it("restamps the journey without moving when the thing was first said", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        groupId: "g1",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separations: separationsTo(KSC, [ARES], 240),
      });
      log.resend(msg.id, [ARES], 2000, new Map([[ARES, 300]]));
      const [out] = log.snapshot().outbox;
      expect(out.msg.sentUt).toBe(1000);
      expect(out.msg.lastSentUt).toBe(2000);
      expect(out.msg.separationSeconds).toBe(300);
      expect(out.msg.attempts).toBe(2);
    });

    it("is ONE message at the recipient even when both copies arrive", () => {
      const first = fromWire({ to: [KSC] });
      expect(log.receiveTransmission(first)).toBe(true);
      expect(
        log.receiveTransmission({ ...first, lastSentUt: 2000, attempts: 2 }),
      ).toBe(false);
      expect(log.snapshot().pending).toHaveLength(1);
    });

    it("answers a resent copy of a message already read with its acknowledgement again", () => {
      const first = fromWire({ to: [KSC] });
      log.receiveTransmission(first);
      log.release("m1", {
        from: KSC,
        stationKey: "screen-a",
        seat: "mission-control",
      });
      // The first acknowledgement is lost on the way back: the author resends.
      wire.acked.length = 0;
      expect(
        log.receiveTransmission({ ...first, lastSentUt: 2000, attempts: 2 }),
      ).toBe(false);
      expect(wire.acked).toEqual([
        {
          messageId: "m1",
          from: KSC,
          stationKey: "screen-a",
          seat: "mission-control",
        },
      ]);
      expect(log.snapshot().inbox).toHaveLength(1);
    });

    it("leaves a resent copy of a message not yet read to the acknowledgement its release will send", () => {
      const first = fromWire({ to: [KSC] });
      log.receiveTransmission(first);
      log.receiveTransmission({ ...first, lastSentUt: 2000, attempts: 2 });
      expect(wire.acked).toEqual([]);
    });

    it("does not confirm a message twice when both copies are answered", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        groupId: "g1",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separations: separationsTo(KSC, [ARES], 240),
      });
      const ack: CommsAck = {
        messageId: msg.id,
        from: ARES,
        stationKey: "pilot-1",
        seat: "pilot",
        atUt: 1240,
        arrivedUt: 1480,
      };
      log.receiveAck(ack);
      log.receiveAck({ ...ack, atUt: 2240, arrivedUt: 2480 });
      expect(log.snapshot().outbox[0].acks).toHaveLength(1);
    });

    it("re-stamps only the recipients it is told to, each on its own separation", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        groupId: "g1",
        body: "do you copy",
        to: [KSC, ARES, WOOMERA],
        sentUt: 1000,
        separations: new Map([
          [ARES, 240],
          [WOOMERA, 12],
        ]),
      });
      log.resend(
        msg.id,
        [ARES],
        2000,
        new Map([
          [ARES, 300],
          [WOOMERA, 14],
        ]),
      );
      const [out] = log.snapshot().outbox;
      expect(out.deliveries).toEqual([
        {
          to: ARES,
          separationSeconds: 300,
          lastSentUt: 2000,
          attempts: 2,
          neverLeft: false,
        },
        {
          to: WOOMERA,
          separationSeconds: 12,
          lastSentUt: 1000,
          attempts: 1,
          neverLeft: false,
        },
      ]);
    });

    it("ignores an acknowledgement from a vantage the message was not addressed to", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        groupId: "g1",
        body: "do you copy",
        to: [KSC, ARES],
        sentUt: 1000,
        separations: new Map([[ARES, 240]]),
      });
      log.receiveAck({
        messageId: msg.id,
        from: WOOMERA,
        stationKey: "stranger",
        seat: "mission-control",
        atUt: 1010,
        arrivedUt: 1020,
      });
      expect(log.snapshot().outbox[0].acks).toHaveLength(0);
    });

    it("does nothing at all for an id this log never sent", () => {
      log.resend("never-sent", [ARES], 2000, new Map([[ARES, 240]]));
      expect(wire.sent).toHaveLength(0);
    });
  });

  it("accepts nothing from the wire before it knows where it is standing", () => {
    const blind = makeLog({ transmitter: wire.transmitter });
    expect(blind.receiveTransmission(fromWire({ to: [KSC] }))).toBe(false);
  });

  it("survives a refresh mid-crossing, holding what was still on its way", () => {
    const storage = memoryStorage();
    const first = makeLog({ storage, transmitter: wire.transmitter });
    first.setVantage(KSC);
    first.receiveTransmission(fromWire({ to: [KSC] }));
    const reopened = makeLog({ storage });
    expect(reopened.snapshot().pending).toHaveLength(1);
  });
});

function fromWire(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "m1",
    to: [KSC],
    from: ARES,
    authorStationKey: "pilot-1",
    authorName: "Jeb",
    authorSeat: "pilot",
    sentUt: 1000,
    lastSentUt: 1000,
    attempts: 1,
    separationSeconds: 240,
    kind: "text",
    groupId: "g1",
    body: "copy that",
    ...over,
  };
}
