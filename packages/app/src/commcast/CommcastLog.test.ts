import { beforeEach, describe, expect, it } from "vitest";
import { CommcastLog, type CommcastTransmitter } from "./CommcastLog";
import type { CommsAck, CommsMessage } from "./types";

const KSC = "ksc";
const ARES = "vessel:ares";

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
  const acked: CommsAck[] = [];
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
      body: "go for the burn",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: 240,
    });
    expect(wire.sent).toEqual([msg]);
    expect(log.snapshot().outbox).toHaveLength(1);
    expect(log.snapshot().outbox[0].neverLeft).toBe(false);
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
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: null,
    });
    expect(wire.sent).toHaveLength(0);
    expect(log.snapshot().outbox[0].neverLeft).toBe(true);
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
      atUt: 1240,
    });
    expect(log.snapshot().inbox).toHaveLength(1);
    expect(log.snapshot().pending).toHaveLength(0);
  });

  it("acknowledges at the ARRIVAL instant, not at the instant it ran", () => {
    // A screen closed for the crossing releases late in wall-clock and must
    // still report the geometry, not its owner's browsing habits.
    log.receiveTransmission(fromWire({ to: [KSC] }));
    log.release("m1", {
      from: KSC,
      stationKey: "screen-a",
      seat: "mission-control",
      atUt: 1240,
    });
    expect(wire.acked).toEqual([
      {
        messageId: "m1",
        from: KSC,
        stationKey: "screen-a",
        seat: "mission-control",
        atUt: 1240,
      },
    ]);
  });

  describe("the idempotent resend", () => {
    it("keeps the message id, so the recipient can dedupe on it", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separationSeconds: 240,
      });
      log.resend(msg.id, 2000, 240);
      expect(wire.sent).toHaveLength(2);
      expect(wire.sent[1].id).toBe(msg.id);
    });

    it("restamps the journey without moving when the thing was first said", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separationSeconds: 240,
      });
      log.resend(msg.id, 2000, 300);
      const [out] = log.snapshot().outbox;
      expect(out.msg.sentUt).toBe(1000);
      expect(out.msg.lastSentUt).toBe(2000);
      expect(out.msg.separationSeconds).toBe(300);
      expect(out.msg.attempts).toBe(2);
    });

    it("is ONE message at the recipient even when both copies arrive", () => {
      const first = fromWire({ to: [KSC] });
      expect(log.receiveTransmission(first)).toBe(true);
      // The resent copy: same id, later stamp. The caller still acknowledges
      // it, which is what makes a resend a re-ask.
      expect(
        log.receiveTransmission({ ...first, lastSentUt: 2000, attempts: 2 }),
      ).toBe(false);
      expect(log.snapshot().pending).toHaveLength(1);
    });

    it("does not confirm a message twice when both copies are answered", () => {
      const msg = log.send(AUTHOR, {
        kind: "text",
        body: "do you copy",
        to: [ARES],
        sentUt: 1000,
        separationSeconds: 240,
      });
      const ack: CommsAck = {
        messageId: msg.id,
        from: ARES,
        stationKey: "pilot-1",
        seat: "pilot",
        atUt: 1240,
      };
      log.receiveAck(ack);
      log.receiveAck({ ...ack, atUt: 2240 });
      expect(log.snapshot().outbox[0].acks).toHaveLength(1);
    });

    it("does nothing at all for an id this log never sent", () => {
      log.resend("never-sent", 2000, 240);
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
    body: "copy that",
    ...over,
  };
}
