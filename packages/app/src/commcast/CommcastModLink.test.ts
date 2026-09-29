import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommcastLog } from "./CommcastLog";
import { attachCommcastModLink, type CommcastWire } from "./CommcastModLink";
import type {
  HeardRadioFrame,
  RadioFrame,
  RadioTransmission,
} from "./radio/wire";

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

function fakeWire() {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  const subscribed: string[] = [];
  const listeners = new Set<(m: ServerMessage) => void>();
  const wire: CommcastWire = {
    dispatch(command, args) {
      sent.push({ command, args: isRecord(args) ? args : {} });
      return { result: Promise.resolve({ success: true }) };
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
    expect(wire.subscribed).toEqual(["commcast.traffic", "commcast.radio"]);
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
      separationSeconds: 5,
    });
    log.send(author, {
      kind: "members",
      groupId: "g1",
      to: [KSC, ARES, "vessel:b"],
      members: [KSC, ARES, "vessel:b"],
      added: ["vessel:b"],
      sentUt: 11,
      separationSeconds: 5,
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
        separationSeconds: 5,
      },
    );
    log.resend(msg.id, 20, 5);

    expect(wire.sent.map((s) => [s.command, s.args.id])).toEqual([
      ["commcast.message.send", msg.id],
      ["commcast.message.send", msg.id],
    ]);
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

  it("hands a message to the log stamped with when the mod delivered it here", () => {
    wire.deliver({
      type: "stream-data",
      topic: "commcast.traffic",
      meta: meta(100, 105),
      payload: {
        kind: "text",
        id: "m1",
        groupId: "g1",
        from: ARES,
        author: { name: "Pilot", stationKey: "screen-b", seat: "pilot" },
        sentUt: { magnitude: 100 },
        to: [ARES, KSC],
        body: "hello",
      },
    });

    const [held] = log.snapshot().pending;
    expect(held?.body).toBe("hello");
    expect(held?.arrivedUt).toBe(105);
    expect(held?.authorSeat).toBe("pilot");
  });

  it("drops what this screen said itself when the mod hands it back", () => {
    wire.deliver({
      type: "stream-data",
      topic: "commcast.traffic",
      meta: meta(100, 100),
      payload: {
        kind: "text",
        id: "m1",
        groupId: "g1",
        from: KSC,
        author: {
          name: "Flight",
          stationKey: "screen-a",
          seat: "mission-control",
        },
        sentUt: { magnitude: 100 },
        to: [KSC, ARES],
        body: "mine",
      },
    });

    expect(log.snapshot().pending).toHaveLength(0);
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
