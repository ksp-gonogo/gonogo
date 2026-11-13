import { beforeEach, describe, expect, it } from "vitest";
import type { OutgoingAck } from "./CommcastLog";
import { CommcastLog, type CommcastTransmitter } from "./CommcastLog";
import { recipientWords } from "./recipientWords";
import {
  deliveryAckUtFor,
  deliveryPhaseFor,
  messageStatusFor,
  separationsTo,
} from "./reveal";
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

  it("hands the mod a message with no path now, and marks it queued rather than never-left", () => {
    /*
     * The mod keeps it for the next path, so the screen never decides it cannot
     * leave; the mod's receipt says who is waiting and who cannot be reached.
     */
    log.send(AUTHOR, {
      kind: "text",
      groupId: "g1",
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separations: separationsTo(KSC, [ARES], null),
    });
    expect(wire.sent).toHaveLength(1);
    const delivery = log.snapshot().outbox[0].deliveries[0];
    expect(delivery?.queued).toBe(true);
    expect(delivery?.neverLeft).toBe(false);
    log.recordReceipt(wire.sent[0]?.id ?? "", [], [ARES]);
    expect(log.snapshot().outbox[0].deliveries[0]?.neverLeft).toBe(true);
    expect(log.snapshot().outbox[0].deliveries[0]?.queued).toBeUndefined();
  });

  it("judges what the wire delivered before the vantage was known once it is", () => {
    const early = makeLog();
    expect(early.receiveTransmission(fromWire({ to: [KSC] }))).toBe(false);
    expect(early.snapshot().pending).toHaveLength(0);

    early.setVantage(KSC);

    expect(early.snapshot().pending).toHaveLength(1);
  });

  it("drops, once the vantage is known, what named another vantage", () => {
    const early = makeLog();
    early.receiveTransmission(fromWire({ id: "m2", to: ["ground:woomera"] }));

    early.setVantage(KSC);

    expect(early.snapshot().pending).toHaveLength(0);
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

describe("a screen that moves between centres", () => {
  const STATION = "ground:station";

  function wire(
    id: string,
    to: string[],
    over: Partial<CommsMessage> = {},
  ): CommsMessage {
    return {
      id,
      groupId: "g1",
      to,
      from: KSC,
      authorStationKey: "other",
      authorName: "Flight",
      authorSeat: "mission-control",
      sentUt: 100,
      lastSentUt: 100,
      attempts: 1,
      separationSeconds: 5,
      kind: "text",
      body: id,
      arrivedUt: 105,
      ...over,
    };
  }

  it("shows only the mail for the centre it stands at, and keeps the rest stored", () => {
    const log = new CommcastLog({ screenKey: "s", storage: memoryStorage() });
    log.setVantage(KSC);
    log.receiveTransmission(wire("for-ksc", [KSC, ARES], { from: ARES }));
    log.setVantage(STATION);
    log.receiveTransmission(wire("for-station", [STATION, ARES]));

    expect(log.snapshot().pending.map((m) => m.id)).toEqual(["for-station"]);
    log.setVantage(KSC);
    expect(log.snapshot().pending.map((m) => m.id)).toEqual(["for-ksc"]);
  });

  it("tells subscribers when the vantage changes what is shown", () => {
    const log = new CommcastLog({ screenKey: "s", storage: memoryStorage() });
    log.setVantage(KSC);
    log.receiveTransmission(wire("a", [KSC, ARES], { from: ARES }));
    const seen: number[] = [];
    log.subscribe((snap) => seen.push(snap.pending.length));
    log.setVantage(STATION);
    expect(seen).toEqual([0]);
  });
});

describe("unread", () => {
  function heard(log: CommcastLog, id: string, groupId = "g1") {
    log.receiveTransmission({
      id,
      groupId,
      to: [KSC, ARES],
      from: ARES,
      authorStationKey: "jeb",
      authorName: "Jeb",
      authorSeat: "pilot",
      sentUt: 10,
      lastSentUt: 10,
      attempts: 1,
      separationSeconds: 5,
      kind: "text",
      body: id,
      arrivedUt: 15,
    });
    log.release(id, { from: KSC, stationKey: "s", seat: "mission-control" });
  }

  it("counts what landed since a group's thread was last open, per screen", () => {
    const log = new CommcastLog({ screenKey: "s", storage: memoryStorage() });
    log.setVantage(KSC);
    heard(log, "m1");
    heard(log, "m2");
    const read = (group: string) => log.snapshot().readThrough[group] ?? 0;
    const unread = (group: string) =>
      log
        .snapshot()
        .inbox.filter(
          (m) => m.groupId === group && (m.receivedSeq ?? 0) > read(group),
        ).length;
    expect(unread("g1")).toBe(2);
    log.markRead("g1");
    expect(unread("g1")).toBe(0);
    heard(log, "m3");
    expect(unread("g1")).toBe(1);
  });

  it("keeps what was read across a reload, and numbers on from the highest it holds", () => {
    const storage = memoryStorage();
    const first = new CommcastLog({ screenKey: "s", storage });
    first.setVantage(KSC);
    heard(first, "m1");
    first.markRead("g1");
    heard(first, "m2");

    const again = new CommcastLog({ screenKey: "s", storage });
    again.setVantage(KSC);
    expect(again.snapshot().readThrough.g1).toBe(1);
    heard(again, "m3");
    const seqs = again.snapshot().inbox.map((m) => m.receivedSeq);
    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe("a colleague's message filed before this screen could time it", () => {
  it("is timed once the separations are read, and a pair nothing has measured stays untimed", () => {
    const log = new CommcastLog({ screenKey: "s", storage: memoryStorage() });
    log.setVantage(KSC);
    log.applyLedger([
      {
        kind: "text",
        id: "m1",
        groupId: "g1",
        from: KSC,
        author: {
          name: "Capcom",
          stationKey: "other",
          seat: "mission-control",
        },
        sentUt: 100,
        to: [KSC, ARES],
        body: "hello",
        delivered: {},
        ended: {},
        read: {},
      },
    ]);
    expect(log.snapshot().outbox[0]?.deliveries[0]?.queued).toBe(true);

    log.setSeparations(() => undefined);
    expect(log.snapshot().outbox[0]?.deliveries[0]?.queued).toBe(true);

    log.setSeparations(() => 240);
    const [delivery] = log.snapshot().outbox[0]?.deliveries ?? [];
    expect(delivery?.queued).toBeUndefined();
    expect(delivery?.separationSeconds).toBe(240);
  });
});

describe("delivery ends on the mod's record of the arrival, never on a read", () => {
  function sendTo(log: CommcastLog) {
    return log.send(AUTHOR, {
      kind: "text",
      groupId: "g1",
      body: "station to craft 1",
      to: [ARES],
      sentUt: 1000,
      separations: separationsTo(KSC, [ARES], 2),
    }).id;
  }

  function ledgerOf(
    id: string,
    landed: number | undefined,
    read: Record<
      string,
      { at: number; stationKey: string; seat: "pilot" }
    > = {},
  ) {
    return [
      {
        kind: "text" as const,
        id,
        groupId: "g1",
        from: KSC,
        author: {
          name: AUTHOR.name,
          stationKey: AUTHOR.stationKey,
          seat: AUTHOR.seat,
        },
        sentUt: 1000,
        to: [KSC, ARES],
        body: "station to craft 1",
        delivered: (landed === undefined ? {} : { [ARES]: landed }) as Record<
          string,
          number
        >,
        ended: {},
        read,
      },
    ];
  }

  it("is delivered from the landing for a recipient that never reads, and offers no resend", () => {
    const log = makeLog();
    log.setVantage(KSC);
    const id = sendTo(log);
    log.applyLedger(ledgerOf(id, 1002));

    const out = log.snapshot().outbox[0];
    const delivery = out?.deliveries[0];
    expect(delivery?.landedUt).toBe(1002);
    expect(out?.acks).toEqual([]);
    expect(deliveryPhaseFor(out, delivery, 1001)).toBe("in-transit");
    expect(deliveryPhaseFor(out, delivery, 1002)).toBe("confirmed");
    expect(deliveryPhaseFor(out, delivery, 1030)).toBe("confirmed");
    expect(messageStatusFor(out, 1030)).toBe("received");
    expect(recipientWords("confirmed", delivery, {}, false)).toBe("delivered");
  });

  it("is delivered, then read, for a recipient with a screen", () => {
    const log = makeLog();
    log.setVantage(KSC);
    const id = sendTo(log);
    log.applyLedger(ledgerOf(id, 1002));
    log.applyLedger(
      ledgerOf(id, 1002, {
        [ARES]: { at: 1010, stationKey: "pilot-1", seat: "pilot" },
      }),
    );

    const out = log.snapshot().outbox[0];
    const delivery = out?.deliveries[0];
    expect(out?.acks).toHaveLength(1);
    expect(deliveryPhaseFor(out, delivery, 1002)).toBe("confirmed");
    expect(
      recipientWords(
        "confirmed",
        delivery,
        {},
        deliveryAckUtFor(out, delivery) !== undefined,
      ),
    ).toBe("delivered, read");
  });

  it("offers a resend only when no arrival is recorded in the expected time", () => {
    const log = makeLog();
    log.setVantage(KSC);
    const id = sendTo(log);
    log.applyLedger(ledgerOf(id, undefined));

    const out = log.snapshot().outbox[0];
    const delivery = out?.deliveries[0];
    expect(deliveryPhaseFor(out, delivery, 1003)).toBe("awaiting-reply");
    expect(deliveryPhaseFor(out, delivery, 1500)).toBe("overdue");
    expect(messageStatusFor(out, 1500)).toBe("unconfirmed");
  });
});
