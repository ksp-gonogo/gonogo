/**
 * The present the radio stamps and releases against, under the clock a relayed
 * screen actually has: one that re-anchors on every sample, at that sample's
 * `deliveredAt`, however late the relay handed it over.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { ViewClock } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterEach, describe, expect, it } from "vitest";
import type { RadioDecoderLike, RadioReceiver } from "./RadioSession";
import { RadioSession } from "./RadioSession";
import { RadioClock } from "./radioClock";
import type { RadioFrame, RadioTransmission } from "./wire";

const UT0 = 1000;
const CHUNK = 0.02;
const SAMPLE_EVERY = 0.2;

afterEach(() => {
  for (const budget of PerfBudget.getAll()) budget.reset();
});

/**
 * A screen's view clock fed the way a station's is: a sample sent every 200 ms
 * of true time, reaching the screen `latency(k)` seconds later.
 */
function relayedClock(latency: (k: number) => number) {
  let wall = 0;
  const clock = new ViewClock({ nowWall: () => wall });
  let next = 0;
  const pending: Array<{ arrives: number; ut: number }> = [];
  return {
    clock,
    /** Move to `to` wall seconds, delivering whatever has arrived by then, in arrival order. */
    advance(to: number) {
      while (next * SAMPLE_EVERY <= to) {
        const sent = next * SAMPLE_EVERY;
        pending.push({ arrives: sent + latency(next), ut: UT0 + sent });
        next += 1;
      }
      pending.sort((a, b) => a.arrives - b.arrives);
      while (pending.length > 0 && (pending[0]?.arrives ?? Infinity) <= to) {
        const sample = pending.shift() as { arrives: number; ut: number };
        wall = sample.arrives;
        clock.observeSample(sample.ut, sample.ut);
      }
      wall = to;
    },
    get wall() {
      return wall;
    },
  };
}

/** A relay that is quick, then stalls for half a second, and repeats. */
const sawtooth = (k: number) => (k % 3 === 2 ? 0.5 : 0.01);

describe("RadioClock", () => {
  it("never steps back across relay jitter, where the raw estimate does", () => {
    const relay = relayedClock(sawtooth);
    const present = new RadioClock({
      source: () => relay.clock.utNowEstimate(),
      nowWall: () => relay.wall,
    });
    let lastRaw = Number.NEGATIVE_INFINITY;
    let rawStepsBack = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (let wall = 0; wall < 10; wall += CHUNK) {
      relay.advance(wall);
      const raw = relay.clock.utNowEstimate();
      if (raw < lastRaw - 1e-9) rawStepsBack += 1;
      lastRaw = raw;
      const now = present.now() as number;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(
      rawStepsBack,
      "the scenario must actually step back",
    ).toBeGreaterThan(5);
    expect(present.stats().absorbed).toBeGreaterThan(5);
    expect(present.stats().largestAbsorbedSeconds).toBeGreaterThan(0.4);
    expect(present.stats().discontinuities).toBe(0);
  });

  it("follows the fastest sample, so it lags the true present by the quickest crossing", () => {
    const relay = relayedClock(sawtooth);
    const present = new RadioClock({
      source: () => relay.clock.utNowEstimate(),
      nowWall: () => relay.wall,
    });
    for (let wall = 0; wall < 10; wall += CHUNK) {
      relay.advance(wall);
      const lag = UT0 + wall - (present.now() as number);
      if (wall > 1) expect(lag).toBeLessThan(0.02);
    }
  });

  it("takes a step back beyond the tolerance, which is a revert and not jitter", () => {
    let raw = 5000;
    let wall = 0;
    const present = new RadioClock({ source: () => raw, nowWall: () => wall });
    expect(present.now()).toBe(5000);
    wall = 1;
    raw = 5001;
    expect(present.now()).toBe(5001);
    wall = 2;
    raw = 4000;
    expect(present.now()).toBe(4000);
    expect(present.stats().discontinuities).toBe(1);
  });

  it("is undefined while there is no clock", () => {
    const present = new RadioClock({ source: () => undefined });
    expect(present.now()).toBeUndefined();
  });
});

describe("radio across a relayed clock", () => {
  function transmission(): RadioTransmission {
    return {
      id: "t1",
      groupId: "g1",
      from: "ksc",
      authorStationKey: "station-1",
      authorName: "Station",
      authorSeat: "mission-control",
      startedUt: UT0,
      separationSeconds: 3,
    };
  }

  /** Wall seconds the station keys at, with its clock long since running. */
  const SPEAKS_AT = 2;

  /**
   * A station talking over a stalling relay to a craft three seconds out, the
   * chunks stamped by `stamp`. Returns the wall instant each chunk was decoded,
   * by `seq`, and how many were dropped.
   */
  function talkOverRelay(
    stamp: (relay: ReturnType<typeof relayedClock>) => () => number,
  ) {
    const relay = relayedClock(sawtooth);
    const ut = stamp(relay);
    let listenerWall = 0;
    const decodedAt = new Map<number, number>();
    const receiver: RadioReceiver = {
      openStream: (): RadioDecoderLike => ({
        decode: (bytes) => decodedAt.set(bytes[0] as number, listenerWall),
        reset: () => {},
        close: () => {},
      }),
      close: () => {},
    };
    const session = new RadioSession({
      view: {
        confirmedEdgeUt: () => UT0 + listenerWall,
        onFrame: () => () => {},
      },
      receiver,
      chunkSeconds: CHUNK,
      nowWall: () => listenerWall,
    });
    session.setVantage({ seat: "pilot", vantageId: "vessel:near" });
    const t = transmission();
    const chunks = 200;
    for (let i = 0; i < chunks + 250; i++) {
      const wall = SPEAKS_AT + i * CHUNK;
      relay.advance(wall);
      listenerWall = wall;
      if (i < chunks) {
        const frame: RadioFrame = {
          kind: "chunk",
          transmissionId: t.id,
          authorStationKey: t.authorStationKey,
          transmission: t,
          to: ["ksc", "vessel:near"],
          seq: i,
          ut: ut(),
          bytes: new Uint8Array(8).fill(i),
        };
        session.receive(frame);
      }
      session.pump(wall);
    }
    const dropped = session.snapshot().droppedChunks;
    session.dispose();
    return { decodedAt, dropped, chunks };
  }

  it("plays every chunk, none of them early, when stamped from the smoothed present", () => {
    const { decodedAt, dropped, chunks } = talkOverRelay((relay) => {
      const present = new RadioClock({
        source: () => relay.clock.utNowEstimate(),
        nowWall: () => relay.wall,
      });
      return () => present.now() as number;
    });
    expect(dropped).toBe(0);
    expect(decodedAt.size).toBe(chunks);
    for (const [seq, at] of decodedAt) {
      expect(at - (SPEAKS_AT + seq * CHUNK)).toBeGreaterThanOrEqual(3 - 0.03);
    }
  });

  it("is the defect this guards: stamped from the raw estimate, words play early", () => {
    const { decodedAt } = talkOverRelay(
      (relay) => () => relay.clock.utNowEstimate(),
    );
    const early = [...decodedAt].filter(
      ([seq, at]) => at - (SPEAKS_AT + seq * CHUNK) < 3 - 0.2,
    );
    expect(early.length).toBeGreaterThan(0);
  });
});
