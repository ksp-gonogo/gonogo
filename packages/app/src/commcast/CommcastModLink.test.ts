import { type Meta, type ServerMessage, value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommcastLog } from "./CommcastLog";
import { attachCommcastModLink, type CommcastWire } from "./CommcastModLink";
import { outboundItems } from "./outboundItems";
import type {
  HeardRadioFrame,
  RadioFrame,
  RadioTransmission,
} from "./radio/wire";
import { recipientWords } from "./recipientWords";
import { messageStatusFor, separationsTo } from "./reveal";
import type { Delivery, OutboundMessage } from "./types";

const KSC = "ground:ksc";
const ARES = "vessel:ares";

function meta(validAt: number, deliveredAt: number): Meta {
  return {
    source: "addressed",
    validAt,
    seq: 1,
    deliveredAt,
    vantage: ARES,
    quality: 0,
    active: true,
    staleness: 0,
    timelineEpoch: 0,
  } as Meta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The base64 chunks a transmit command carried. */
function chunksOf(args: Record<string, unknown> | undefined): string[] {
  const chunks = args?.chunks;
  return Array.isArray(chunks)
    ? chunks.filter((c): c is string => typeof c === "string")
    : [];
}

function fakeWire(
  reply: (command: string, args: Record<string, unknown>) => unknown = () => ({
    success: true,
  }),
) {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  const subscribed: string[] = [];
  const listeners = new Set<(m: ServerMessage) => void>();
  const wire: CommcastWire = {
    dispatch(command, args) {
      const sentArgs = isRecord(args) ? args : {};
      sent.push({ command, args: sentArgs });
      return { result: Promise.resolve(reply(command, sentArgs)) };
    },
    subscribe(topic) {
      subscribed.push(topic);
      return () => {};
    },
    onRawMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const deliver = (m: ServerMessage) => {
    for (const l of listeners) l(m);
  };
  return { wire, sent, subscribed, deliver };
}

function makeLog(vantage: string) {
  const log = new CommcastLog({ screenKey: "screen-a", storage: undefined });
  log.setVantage(vantage);
  return log;
}

const TRANSMISSION: RadioTransmission = {
  id: "t1",
  groupId: "g1",
  from: ARES,
  authorStationKey: "screen-a",
  authorName: "Pilot",
  authorSeat: "pilot",
  startedUt: 100,
  separationSeconds: 5,
};

function chunk(seq: number): RadioFrame {
  return {
    kind: "chunk",
    transmissionId: "t1",
    authorStationKey: "screen-a",
    transmission: TRANSMISSION,
    to: [ARES, KSC],
    seq,
    ut: 100 + seq * 0.02,
    bytes: new Uint8Array([seq]),
  };
}

function binaryFrame(
  batch: Record<string, unknown>,
  chunks: Uint8Array[],
  validAt: number,
  deliveredAt: number,
): ServerMessage {
  return {
    type: "stream-binary",
    topic: "commcast.radio",
    meta: meta(validAt, deliveredAt),
    segments: [new TextEncoder().encode(JSON.stringify(batch)), ...chunks],
  };
}

describe("attachCommcastModLink", () => {
  let wire: ReturnType<typeof fakeWire>;
  let log: CommcastLog;
  let detach: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    wire = fakeWire();
    log = makeLog(KSC);
    detach = attachCommcastModLink(log, wire.wire);
  });

  afterEach(() => {
    detach();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("holds both commcast topics for as long as it is attached", () => {
    expect(wire.subscribed).toEqual(["commcast.ledger", "commcast.radio"]);
  });

  it("sends a group's opening change as an open and a later one as an add", () => {
    const author = {
      stationKey: "screen-a",
      name: "Flight",
      seat: "mission-control" as const,
      vantageId: KSC,
    };
    log.send(author, {
      kind: "members",
      groupId: "g1",
      to: [KSC, ARES],
      members: [KSC, ARES],
      added: [ARES],
      sentUt: 10,
      separations: separationsTo(KSC, [KSC, ARES], 5),
    });
    log.send(author, {
      kind: "members",
      groupId: "g1",
      to: [KSC, ARES, "vessel:b"],
      members: [KSC, ARES, "vessel:b"],
      added: ["vessel:b"],
      sentUt: 11,
      separations: separationsTo(KSC, [KSC, ARES, "vessel:b"], 5),
    });

    expect(wire.sent.map((s) => s.command)).toEqual([
      "commcast.group.open",
      "commcast.group.add",
    ]);
    expect(wire.sent[0]?.args.members).toEqual([KSC, ARES]);
    expect(wire.sent[1]?.args.added).toEqual(["vessel:b"]);
  });

  it("sends text with the id the author minted, so a resend is the same message", () => {
    const msg = log.send(
      {
        stationKey: "screen-a",
        name: "Flight",
        seat: "mission-control",
        vantageId: KSC,
      },
      {
        kind: "text",
        body: "go",
        groupId: "g1",
        to: [KSC, ARES],
        sentUt: 10,
        separations: separationsTo(KSC, [KSC, ARES], 5),
      },
    );
    log.resend(msg.id, [ARES], 20, new Map([[ARES, 5]]));

    expect(wire.sent.map((s) => [s.command, s.args.id])).toEqual([
      ["commcast.message.send", msg.id],
      ["commcast.message.send", msg.id],
    ]);
  });

  it("names the recipients on a resend to some of the group, and on nothing else", () => {
    const msg = log.send(
      {
        stationKey: "screen-a",
        name: "Flight",
        seat: "mission-control",
        vantageId: KSC,
      },
      {
        kind: "text",
        body: "go",
        groupId: "g1",
        to: [KSC, ARES, "vessel:b"],
        sentUt: 10,
        separations: separationsTo(KSC, [KSC, ARES, "vessel:b"], 5),
      },
    );
    log.resend(msg.id, ["vessel:b"], 20, new Map([["vessel:b", 5]]));

    expect(wire.sent.map((s) => s.args.to)).toEqual([undefined, ["vessel:b"]]);
  });

  it("marks a member the receipt says was unreached as never left, and leaves the other in transit", async () => {
    const reply = fakeWire((command) =>
      command === "commcast.message.send"
        ? {
            success: true,
            payload: { addressed: [KSC, ARES], unreached: ["vessel:b"] },
          }
        : { success: true },
    );
    detach();
    detach = attachCommcastModLink(log, reply.wire);

    log.send(
      {
        stationKey: "screen-a",
        name: "Flight",
        seat: "mission-control",
        vantageId: KSC,
      },
      {
        kind: "text",
        body: "go",
        groupId: "g1",
        to: [KSC, ARES, "vessel:b"],
        sentUt: 10,
        separations: separationsTo(KSC, [KSC, ARES, "vessel:b"], 5),
      },
    );
    await vi.advanceTimersByTimeAsync(0);

    const deliveries = log.snapshot().outbox[0]?.deliveries ?? [];
    expect(deliveries.map((d) => [d.to, d.neverLeft, d.delivered])).toEqual([
      [ARES, false, true],
      ["vessel:b", true, undefined],
    ]);
  });

  const notFound = {
    success: false,
    errorCode: "notFound",
    detail: "this conversation no longer exists",
  };

  const author = {
    stationKey: "screen-a",
    name: "Flight",
    seat: "mission-control" as const,
    vantageId: KSC,
  };

  const textTo = (members: string[]) => ({
    kind: "text" as const,
    body: "go",
    groupId: "g1",
    to: members,
    sentUt: 10,
    separations: separationsTo(KSC, members, 5),
  });

  it("opens a conversation the mod has forgotten with its members, then says the words again", async () => {
    let known = false;
    const forgetful = fakeWire((command) => {
      if (command === "commcast.group.open") {
        known = true;
        return { success: true };
      }
      return known
        ? {
            success: true,
            payload: { addressed: [KSC, ARES], unreached: [] },
          }
        : notFound;
    });
    detach();
    detach = attachCommcastModLink(log, forgetful.wire);
    log.send(author, {
      kind: "members",
      groupId: "g1",
      to: [KSC, ARES],
      members: [KSC, ARES],
      added: [ARES],
      sentUt: 0,
      separations: new Map(),
    });
    await vi.advanceTimersByTimeAsync(0);
    known = false;

    const msg = log.send(author, textTo([KSC, ARES]));
    await vi.advanceTimersByTimeAsync(0);

    expect(forgetful.sent.map((s) => s.command)).toEqual([
      "commcast.group.open",
      "commcast.message.send",
      "commcast.group.open",
      "commcast.message.send",
    ]);
    expect(forgetful.sent[2]?.args.members).toEqual([ARES, KSC].sort());
    expect(forgetful.sent[3]?.args.id).toBe(msg.id);
    expect(
      log
        .snapshot()
        .outbox.at(-1)
        ?.deliveries.some((d) => d.refused),
    ).toBe(false);
  });

  it("says a send the mod refuses and cannot recover was not sent, which is not an unanswered one", async () => {
    const refusing = fakeWire((command) =>
      command === "commcast.message.send" ? notFound : { success: true },
    );
    detach();
    detach = attachCommcastModLink(log, refusing.wire);

    log.send(author, textTo([KSC, ARES]));
    await vi.advanceTimersByTimeAsync(0);

    const out = log.snapshot().outbox[0];
    expect(out?.deliveries.every((d) => d.refused)).toBe(true);
    expect(messageStatusFor(out as OutboundMessage, 1_000_000)).toBe(
      "not-sent",
    );
    expect(refusing.sent.map((s) => s.command)).toEqual([
      "commcast.message.send",
    ]);
  });

  it("keeps the reason the mod gave for refusing a send, so the delivery can say why", async () => {
    const refusing = fakeWire((command) =>
      command === "commcast.message.send"
        ? {
            success: false,
            errorCode: "wrongState",
            reason: "this screen isn't at a command centre or on a craft",
          }
        : { success: true },
    );
    detach();
    detach = attachCommcastModLink(log, refusing.wire);

    log.send(author, textTo([KSC, ARES]));
    await vi.advanceTimersByTimeAsync(0);

    const out = log.snapshot().outbox[0];
    expect(out?.deliveries.map((d) => d.refusedReason)).toEqual([
      "this screen isn't at a command centre or on a craft",
    ]);
    expect(recipientWords("lost", out?.deliveries[0] as Delivery)).toBe(
      "not sent, this screen isn't at a command centre or on a craft",
    );
  });

  it("marks a send the link provably never carried as not sent, with the link's words", async () => {
    const down: CommcastWire = {
      dispatch: () => ({
        result: Promise.reject(
          Object.assign(new Error("no open connection to the game"), {
            code: "undelivered",
          }),
        ),
      }),
      subscribe: () => () => {},
      onRawMessage: () => () => {},
    };
    detach();
    detach = attachCommcastModLink(log, down);

    log.send(author, textTo([KSC, ARES]));
    await vi.advanceTimersByTimeAsync(0);

    const out = log.snapshot().outbox[0];
    expect(out?.deliveries.every((d) => d.refused)).toBe(true);
    expect(out?.deliveries[0]?.refusedReason).toBe(
      "no open connection to the game",
    );
  });

  it("hands the reason for a refused transmit to whoever listens", async () => {
    const refusing = fakeWire(() => ({
      success: false,
      errorCode: "wrongState",
      reason: "this screen isn't at a command centre or on a craft",
    }));
    const refused = vi.fn();
    log.onRadioRefused(refused);
    detach();
    detach = attachCommcastModLink(log, refusing.wire);
    log.sendRadio(chunk(0));
    log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "screen-a",
      ut: 101,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refused).toHaveBeenCalledWith(
      "this screen isn't at a command centre or on a craft",
    );
  });

  it("sends one command for a send to sixty-four members, within the command budget", () => {
    const members = [
      KSC,
      ...Array.from({ length: 63 }, (_, i) => `vessel:m${i}`),
    ];
    log.send(
      {
        stationKey: "screen-a",
        name: "Flight",
        seat: "mission-control",
        vantageId: KSC,
      },
      {
        kind: "text",
        body: "all stations",
        groupId: "g1",
        to: members,
        sentUt: 10,
        separations: separationsTo(KSC, members, 5),
      },
    );

    expect(wire.sent.map((s) => s.command)).toEqual(["commcast.message.send"]);
    expect(log.snapshot().outbox[0]?.deliveries).toHaveLength(63);
  });

  it("settles a membership change at once for its author, ahead of the message that follows it", () => {
    const author = {
      stationKey: "screen-a",
      name: "Flight",
      seat: "mission-control" as const,
      vantageId: KSC,
    };
    const everyone = [KSC, ARES, "vessel:b"];
    log.send(author, {
      kind: "members",
      groupId: "g1",
      to: everyone,
      members: everyone,
      added: ["vessel:b"],
      sentUt: 10,
      separations: separationsTo(KSC, everyone, 500),
    });
    log.send(author, {
      kind: "text",
      body: "welcome",
      groupId: "g1",
      to: everyone,
      sentUt: 10,
      separations: separationsTo(KSC, everyone, 500),
    });

    expect(wire.sent.map((s) => s.command)).toEqual([
      "commcast.group.add",
      "commcast.message.send",
    ]);
    const [change, said] = log.snapshot().outbox;
    expect(change?.deliveries).toEqual([]);
    const rail = outboundItems(log.snapshot().outbox, 11).map((i) => i.id);
    expect(rail.every((id) => id.startsWith(`${said?.msg.id}/`))).toBe(true);
    expect(rail).toHaveLength(2);
  });

  it("does not acknowledge a membership change, new or heard again", () => {
    const change = {
      id: "g1@100",
      groupId: "g1",
      to: [KSC, ARES],
      from: ARES,
      authorStationKey: "screen-b",
      authorName: "Pilot",
      authorSeat: "pilot" as const,
      sentUt: 100,
      lastSentUt: 100,
      attempts: 1,
      separationSeconds: 5,
      kind: "members" as const,
      members: [KSC, ARES],
      added: [KSC],
    };
    const ack = {
      from: KSC,
      stationKey: "screen-a",
      seat: "mission-control" as const,
    };
    log.receiveTransmission(change);
    log.release(change.id, ack);
    log.receiveTransmission(change);

    expect(log.snapshot().inbox).toHaveLength(1);
    expect(wire.sent).toEqual([]);
  });

  it("batches radio into 200 ms per command, and flushes what is left at key-up", () => {
    for (let seq = 0; seq < 12; seq++) log.sendRadio(chunk(seq));
    log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "screen-a",
      ut: 101,
    });

    const batches = wire.sent.filter(
      (s) => s.command === "commcast.radio.transmit",
    );
    expect(
      batches.map((b) => [b.args.seq, chunksOf(b.args).length, b.args.end]),
    ).toEqual([
      [0, 10, false],
      [10, 2, true],
    ]);
    expect(atob(chunksOf(batches[0]?.args)[3] ?? "")).toBe(
      String.fromCharCode(3),
    );
  });

  it("tells the log when the mod refuses a transmit, and not when its reply is lost", async () => {
    const rejecting = (code: string) => {
      const wire: CommcastWire = {
        dispatch: () => ({
          result: Promise.reject(Object.assign(new Error("no"), { code })),
        }),
        subscribe: () => () => {},
        onRawMessage: () => () => {},
      };
      return wire;
    };
    const refused = vi.fn();
    log.onRadioRefused(refused);

    detach();
    detach = attachCommcastModLink(log, rejecting("E_LOST"));
    log.sendRadio(chunk(0));
    log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "screen-a",
      ut: 101,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refused).not.toHaveBeenCalled();

    detach();
    detach = attachCommcastModLink(log, rejecting("unknownVantage"));
    log.sendRadio(chunk(0));
    log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "screen-a",
      ut: 101,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refused).toHaveBeenCalled();
  });

  it("ends a keying whose last batch was already full, naming its group", () => {
    for (let seq = 0; seq < 10; seq++) log.sendRadio(chunk(seq));
    log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "screen-a",
      ut: 101,
    });

    const last = wire.sent.at(-1)?.args;
    expect(last?.end).toBe(true);
    expect(last?.groupId).toBe("g1");
    expect(last?.seq).toBe(10);
    expect(last?.chunks).toEqual([]);
  });

  it("sends a part-filled batch up once it has waited long enough", () => {
    log.sendRadio(chunk(0));
    expect(wire.sent).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(wire.sent.map((s) => s.command)).toEqual([
      "commcast.radio.transmit",
    ]);
  });

  const ledgerFrame = (items: unknown[], deliveredAt: number) =>
    wire.deliver({
      type: "stream-data",
      topic: "commcast.ledger",
      meta: meta(deliveredAt, deliveredAt),
      payload: { items },
    });

  const heardItem = (over: Record<string, unknown> = {}) => ({
    kind: "text",
    id: "m1",
    groupId: "g1",
    from: ARES,
    author: { name: "Pilot", stationKey: "screen-b", seat: "pilot" },
    sentUt: 100,
    to: [ARES, KSC],
    body: "hello",
    arrivedUt: 105,
    ...over,
  });

  it("hands what reached this vantage to the log, stamped with when it arrived, and once however often the ledger is said", () => {
    ledgerFrame([heardItem()], 105);
    ledgerFrame([heardItem()], 110);

    const [held, ...rest] = log.snapshot().pending;
    expect(rest).toHaveLength(0);
    expect(held?.body).toBe("hello");
    expect(held?.arrivedUt).toBe(105);
    expect(held?.authorSeat).toBe("pilot");
  });

  it("reads the times of a ledger the client has already decoded into values with their unit", () => {
    ledgerFrame(
      [
        heardItem({
          sentUt: value("ut", 100),
          arrivedUt: value("ut", 105),
        }),
      ],
      105,
    );

    const [held] = log.snapshot().pending;
    expect(held?.body).toBe("hello");
    expect(held?.arrivedUt).toBe(105);
  });

  it("files what this screen said itself once, and settles each recipient on the ledger", () => {
    const sent = log.send(author, {
      ...textTo([KSC, ARES]),
      separations: new Map([[ARES, 240]]),
    });
    const said = (over: Record<string, unknown>) => ({
      kind: "text",
      id: sent.id,
      groupId: "g1",
      from: KSC,
      author: {
        name: "Flight",
        stationKey: "screen-a",
        seat: "mission-control",
      },
      sentUt: 100,
      to: [ARES, KSC],
      body: sent.body,
      ...over,
    });
    ledgerFrame([said({})], 100);
    expect(log.snapshot().outbox).toHaveLength(1);
    expect(log.snapshot().pending).toHaveLength(0);

    ledgerFrame([said({ delivered: { [ARES]: 580 } })], 580);
    expect(log.snapshot().outbox[0]?.deliveries[0]?.delivered).toBe(true);

    ledgerFrame(
      [
        said({
          delivered: { [ARES]: 580 },
          read: {
            [ARES]: { at: 340, stationKey: "screen-jeb", seat: "pilot" },
          },
        }),
      ],
      590,
    );
    const [ack] = log.snapshot().outbox[0]?.acks ?? [];
    expect(ack?.from).toBe(ARES);
    expect(ack?.arrivedUt).toBe(590);
  });

  it("marks a recipient whose copy was cancelled as not sent, with the reason", () => {
    const sent = log.send(author, {
      ...textTo([KSC, ARES]),
      separations: new Map([[ARES, null]]),
    });
    ledgerFrame(
      [
        {
          kind: "text",
          id: sent.id,
          groupId: "g1",
          from: KSC,
          author: {
            name: "Flight",
            stationKey: "screen-a",
            seat: "mission-control",
          },
          sentUt: 100,
          to: [ARES, KSC],
          body: sent.body,
          ended: { [ARES]: "cancelled" },
        },
      ],
      200,
    );
    const delivery = log.snapshot().outbox[0]?.deliveries[0];
    expect(delivery?.refused).toBe(true);
    expect(delivery?.refusedReason).toBe("cancelled");
    expect(delivery?.queued).toBeUndefined();
  });

  it("holds a colleague's message as this vantage's own outgoing mail", () => {
    ledgerFrame(
      [
        {
          kind: "text",
          id: "m9",
          groupId: "g1",
          from: KSC,
          author: {
            name: "Capcom",
            stationKey: "screen-colleague",
            seat: "mission-control",
          },
          sentUt: 100,
          to: [ARES, KSC],
          body: "from next door",
        },
      ],
      100,
    );

    const snap = log.snapshot();
    expect(snap.pending).toHaveLength(0);
    expect(snap.inbox).toHaveLength(0);
    const out = snap.outbox[0];
    expect(out?.msg.body).toBe("from next door");
    expect(out?.deliveries.map((d) => [d.to, d.queued])).toEqual([
      [ARES, true],
    ]);
  });

  it("never answers what it files as outgoing", () => {
    const acked: unknown[] = [];
    log.setTransmitter({
      transmit: () => {},
      acknowledge: (a) => acked.push(a),
    });
    ledgerFrame(
      [
        {
          kind: "text",
          id: "m9",
          groupId: "g1",
          from: KSC,
          author: {
            name: "Capcom",
            stationKey: "other",
            seat: "mission-control",
          },
          sentUt: 100,
          to: [ARES, KSC],
          body: "from next door",
        },
      ],
      100,
    );
    expect(acked).toHaveLength(0);
  });

  it("places each radio chunk at its own arrival, 20 ms apart, ending at the delivery", () => {
    const heard: HeardRadioFrame[] = [];
    log.onRadio((f) => heard.push(f));

    wire.deliver(
      binaryFrame(
        {
          transmissionId: "t9",
          groupId: "g1",
          from: ARES,
          author: { name: "Pilot", stationKey: "screen-b", seat: "pilot" },
          startedUt: 90,
          seq: 20,
          end: true,
          to: [ARES, KSC],
        },
        [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
        100,
        105,
      ),
    );

    const chunks = heard.filter((f) => f.kind === "chunk");
    expect(chunks.map((c) => [c.seq, c.arrivedUt])).toEqual([
      [20, 105 - 0.04],
      [21, 105 - 0.02],
      [22, 105],
    ]);
    expect(heard.at(-1)?.kind).toBe("end");
    expect(chunks[0]?.transmission.from).toBe(ARES);
  });
});
