/**
 * The listening end of the radio, which is where every delay decision is made.
 *
 * Driven off a hand-rolled clock and a recording decoder rather than a browser:
 * what is under test is WHEN a chunk may be heard and what a cut does, and both
 * of those are arithmetic. The audio graph is exercised in a real engine by
 * `tests/playwright/radio-capability.spec.ts`.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import type { SeparationMatrix, Vantage } from "../reveal";
import type { RadioDecoderLike } from "./RadioSession";
import { RadioSession } from "./RadioSession";
import type { RadioFrame, RadioTransmission } from "./wire";

const ARES = "vessel:ares";
const KSC = "ksc";
const LIGHT_TIME = 240;
const CHUNK = 0.02;

const GROUND: Vantage = { seat: "mission-control", vantageId: KSC };

/** A clock the test moves by hand. `onFrame` is registered and never fired, so
 *  nothing releases except where the test asks for it. */
function fakeClock(startUt = 0) {
  let ut = startUt;
  const subscribers = new Set<(ut: number) => void>();
  return {
    view: {
      confirmedEdgeUt: () => ut,
      onFrame: (cb: (ut: number) => void) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
    },
    set(next: number) {
      ut = next;
    },
  };
}

function recordingDecoder() {
  const decoded: Array<{ bytes: Uint8Array; timestamp: number }> = [];
  let resets = 0;
  let closed = false;
  const decoder: RadioDecoderLike = {
    decode: (bytes, timestamp) => decoded.push({ bytes, timestamp }),
    reset: () => {
      resets += 1;
    },
    close: () => {
      closed = true;
    },
  };
  return {
    decoder,
    decoded,
    get resets() {
      return resets;
    },
    get closed() {
      return closed;
    },
  };
}

function transmission(
  over: Partial<RadioTransmission> = {},
): RadioTransmission {
  return {
    id: "t1",
    to: [KSC],
    from: ARES,
    authorStationKey: "pilot-1",
    authorName: "Jeb",
    authorSeat: "pilot",
    startedUt: 1000,
    separationSeconds: LIGHT_TIME,
    ...over,
  };
}

function start(t: RadioTransmission): RadioFrame {
  return {
    kind: "start",
    transmissionId: t.id,
    authorStationKey: t.authorStationKey,
    transmission: t,
  };
}

function chunk(
  t: RadioTransmission,
  seq: number,
  ut: number,
  bytes = 64,
): RadioFrame {
  return {
    kind: "chunk",
    transmissionId: t.id,
    authorStationKey: t.authorStationKey,
    seq,
    ut,
    bytes: new Uint8Array(bytes).fill(seq % 256),
  };
}

const sessions: RadioSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const budget of PerfBudget.getAll()) budget.reset();
});

function scene(
  opts: {
    me?: Vantage;
    pairs?: SeparationMatrix;
    maxBufferedBytes?: number;
    maxBacklogSeconds?: number;
    startUt?: number;
  } = {},
) {
  const clock = fakeClock(opts.startUt ?? 0);
  const sink = recordingDecoder();
  const session = new RadioSession({
    view: clock.view,
    decoder: sink.decoder,
    chunkSeconds: CHUNK,
    ...(opts.maxBufferedBytes === undefined
      ? {}
      : { maxBufferedBytes: opts.maxBufferedBytes }),
    ...(opts.maxBacklogSeconds === undefined
      ? {}
      : { maxBacklogSeconds: opts.maxBacklogSeconds }),
  });
  session.setVantage(opts.me ?? GROUND);
  session.setPairs(opts.pairs);
  sessions.push(session);
  return { clock, sink, session };
}

describe("radio playout, held by the light-time", () => {
  it("plays nothing until the crossing is over, then plays it", () => {
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));

    clock.set(1000 + LIGHT_TIME - 0.001);
    session.pump(100);
    expect(sink.decoded).toHaveLength(0);

    clock.set(1000 + LIGHT_TIME);
    session.pump(100);
    expect(sink.decoded).toHaveLength(1);
  });

  it("releases against the reader's OWN present, not a round trip", () => {
    // The whole point of `utNowEstimate()` over `confirmedEdgeUt()`: a word
    // spoken at 1000 across a four-minute path is heard at 1240, never 1480.
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));
    clock.set(1000 + 2 * LIGHT_TIME - 1);
    session.pump(100);
    expect(sink.decoded).toHaveLength(1);
  });

  it("freezes the separation for the whole transmission", () => {
    /*
     * A published pair arriving mid-word must not move the chunks still to
     * come: re-resolving per chunk jitters the playout across the 20 ms grid
     * and, on a shrinking separation, reorders syllables inside a word.
     */
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));

    const nearer: SeparationMatrix = new Map([[ARES, new Map([[KSC, 5]])]]);
    session.setPairs(nearer);
    session.receive(chunk(t, 1, 1000 + CHUNK));

    clock.set(1005);
    session.pump(100);
    expect(sink.decoded).toHaveLength(0);

    clock.set(1000 + LIGHT_TIME + CHUNK);
    session.pump(100);
    session.pump(100 + CHUNK);
    expect(sink.decoded).toHaveLength(2);
  });

  it("resolves the separation at the READER when the matrix covers the pair", () => {
    const pairs: SeparationMatrix = new Map([[ARES, new Map([[KSC, 60]])]]);
    const { clock, sink, session } = scene({ pairs });
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));
    clock.set(1060);
    session.pump(100);
    expect(sink.decoded).toHaveLength(1);
  });

  it("plays in release order however the wire delivered it", () => {
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 1, 1000 + CHUNK));
    session.receive(chunk(t, 0, 1000));
    clock.set(2000);
    session.pump(100);
    session.pump(101);
    expect(sink.decoded.map((d) => d.bytes[0])).toEqual([0, 1]);
  });

  it("starts a fresh decode for a second keying", () => {
    const { clock, sink, session } = scene();
    const first = transmission({ id: "t1" });
    const second = transmission({ id: "t2", startedUt: 2000 });
    session.receive(start(first));
    session.receive(chunk(first, 0, 1000));
    session.receive(start(second));
    session.receive(chunk(second, 0, 2000));
    clock.set(3000);
    session.pump(100);
    session.pump(200);
    expect(sink.decoded).toHaveLength(2);
    expect(sink.resets).toBe(2);
  });
});

describe("radio playout, a cut", () => {
  it("is silence, and says NOTHING about itself", () => {
    // Announcing "somebody is transmitting and you cannot hear them" would be
    // the faster-than-light channel the delay model exists to avoid. The
    // transmitter learns through absence of acknowledgement, at their own end.
    const { clock, sink, session } = scene();
    const t = transmission({ separationSeconds: null });
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));
    clock.set(9999);
    session.pump(100);

    expect(sink.decoded).toHaveLength(0);
    expect(session.snapshot()).toEqual({
      playing: null,
      backlogSeconds: 0,
      droppedChunks: 0,
    });
  });

  it("drops chunks of a keying whose opening frame never arrived", () => {
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(chunk(t, 0, 1000));
    clock.set(9999);
    session.pump(100);
    expect(sink.decoded).toHaveLength(0);
  });
});

describe("radio playout, what the operator is told", () => {
  it("names who is being played, and falls silent when they finish", () => {
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.receive(chunk(t, 0, 1000));
    session.receive({
      kind: "end",
      transmissionId: t.id,
      authorStationKey: t.authorStationKey,
      ut: 1000 + CHUNK,
    });
    // Key-up crosses at the speed of the internet while the words it ends are
    // still crossing the light-time, so the name has to survive it.
    expect(session.snapshot().playing).toBeNull();

    clock.set(1000 + LIGHT_TIME);
    session.pump(100);
    expect(sink.decoded).toHaveLength(1);
    expect(session.snapshot().playing).toBeNull();
  });

  it("reports a backlog rather than playing faster to catch up", () => {
    // The warp caveat, made a reading. Five chunks come off the delay clock at
    // once; playback takes them one 20 ms step at a time and says how far
    // behind it is meanwhile.
    const { clock, session } = scene();
    const t = transmission();
    session.receive(start(t));
    for (let seq = 0; seq < 5; seq++) {
      session.receive(chunk(t, seq, 1000 + seq * CHUNK));
    }
    clock.set(1000 + LIGHT_TIME + 5 * CHUNK);
    session.pump(100);
    expect(session.snapshot().backlogSeconds).toBeCloseTo(4 * CHUNK, 6);
    expect(session.snapshot().playing?.authorName).toBe("Jeb");

    session.pump(100 + CHUNK);
    expect(session.snapshot().backlogSeconds).toBeCloseTo(3 * CHUNK, 6);
  });

  it("evicts the oldest at the cap, and counts what it dropped", () => {
    // 20 ms per eviction and nothing downstream: every Opus chunk is a key
    // frame, so a dropped one costs its own audio and corrupts nothing after
    // it. That is why the buffer runs drop-oldest rather than GOP-safe.
    const { clock, sink, session } = scene({ maxBufferedBytes: 128 });
    const t = transmission();
    session.receive(start(t));
    for (let seq = 0; seq < 6; seq++) {
      session.receive(chunk(t, seq, 1000 + seq * CHUNK));
    }
    expect(session.snapshot().droppedChunks).toBeGreaterThan(0);

    clock.set(2000);
    for (let tick = 0; tick < 6; tick++) session.pump(100 + tick);
    expect(sink.decoded.length).toBeLessThan(6);
    // What survived is the NEWEST end of the stream, never a hole in the middle.
    expect(sink.decoded.at(-1)?.bytes[0]).toBe(5);
  });

  it("snaps past a backlog it can never drain, rather than lagging forever", () => {
    const { clock, sink, session } = scene({ maxBacklogSeconds: 0.25 });
    const t = transmission();
    session.receive(start(t));
    for (let seq = 0; seq < 4; seq++) {
      session.receive(chunk(t, seq, 1000 + seq * CHUNK));
    }
    clock.set(1000 + LIGHT_TIME + 4 * CHUNK);
    session.pump(100);
    expect(sink.decoded).toHaveLength(1);

    // A whole second later with nothing having drained: the pacer gives up on
    // the backlog and plays the newest chunk it holds.
    session.pump(101);
    expect(sink.decoded).toHaveLength(2);
    expect(sink.decoded.at(-1)?.bytes[0]).toBe(3);
    expect(session.snapshot().droppedChunks).toBe(2);
  });
});

describe("radio playout, teardown", () => {
  it("closes the decoder and stops answering", () => {
    const { clock, sink, session } = scene();
    const t = transmission();
    session.receive(start(t));
    session.dispose();
    session.receive(chunk(t, 0, 1000));
    clock.set(9999);
    session.pump(100);
    expect(sink.closed).toBe(true);
    expect(sink.decoded).toHaveLength(0);
    expect(session.snapshot().playing).toBeNull();
  });
});

describe("radio, inside its budgets", () => {
  it("a talker at the 20 ms grid never approaches the chunk cap", () => {
    const { session } = scene();
    const t = transmission();
    session.receive(start(t));
    for (let seq = 0; seq < 50; seq++) {
      session.receive(chunk(t, seq, 1000 + seq * CHUNK, 86));
    }
    const chunks = PerfBudget.getAll().find(
      (b) => b.name === "CommcastRadio chunks/sec",
    );
    const bytes = PerfBudget.getAll().find(
      (b) => b.name === "CommcastRadio encoded bytes/sec",
    );
    expect(chunks?.getExceedanceCount()).toBe(0);
    expect(bytes?.getExceedanceCount()).toBe(0);
    // One second of the worst engine measured in slice 0, well under both caps.
    expect(chunks?.rate()).toBe(50);
    expect(bytes?.rate()).toBe(50 * 86);
  });
});
