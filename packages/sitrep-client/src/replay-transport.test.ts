import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { type ReplayFixture, ReplayTransport } from "./replay-transport";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * Minimal deterministic `Clock` test double — time only moves on
 * `advanceTo`, mirroring `client.test.ts`'s own `FakeClock`/sitrep-server's
 * `ManualClock` semantics. `ReplayTransport` must never race real timers, so
 * every test below drives delivery entirely through this.
 */
class FakeClock implements Clock {
  private currentUt: number;
  private pending: { atUt: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(startUt = 0) {
    this.currentUt = startUt;
  }

  now(): number {
    return this.currentUt;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const callback = { atUt, fn, cancelled: false };
    this.pending.push(callback);
    return () => {
      callback.cancelled = true;
    };
  }

  /** Advances to `ut`, firing every due callback in ASCENDING `atUt` order (never insertion order) — proves delivery order is driven by schedule time, not array position. */
  advanceTo(ut: number): void {
    this.currentUt = ut;
    const due = this.pending
      .filter((cb) => !cb.cancelled && cb.atUt <= ut)
      .sort((a, b) => a.atUt - b.atUt);
    this.pending = this.pending.filter((cb) => cb.cancelled || cb.atUt > ut);
    for (const cb of due) cb.fn();
  }

  pendingCount(): number {
    return this.pending.length;
  }
}

function frame(topic: string, payload: unknown, deliveredAt: number): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: makeMeta({ validAt: deliveredAt, deliveredAt }),
  };
  return JSON.stringify(message);
}

describe("ReplayTransport", () => {
  it("declares carriedChannels as the fixture's topic set (from subscribedTopics when given)", () => {
    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.orbit", "vessel.flight"],
      frames: [frame("vessel.orbit", { sma: 1 }, 0)],
    };
    const clock = new FakeClock();
    const transport = new ReplayTransport(fixture, { clock });
    expect(transport.carriedChannels).toEqual([
      "vessel.orbit",
      "vessel.flight",
    ]);
  });

  it("derives carriedChannels from the distinct frame topics when subscribedTopics is omitted", () => {
    const fixture: ReplayFixture = {
      frames: [
        frame("vessel.orbit", { sma: 1 }, 0),
        frame("vessel.orbit", { sma: 2 }, 1),
        frame("vessel.flight", { altitudeAsl: 5 }, 2),
      ],
    };
    const clock = new FakeClock();
    const transport = new ReplayTransport(fixture, { clock });
    expect(new Set(transport.carriedChannels)).toEqual(
      new Set(["vessel.orbit", "vessel.flight"]),
    );
  });

  it("delivers frames in ascending meta.deliveredAt order, anchored to the clock's now() at construction — even when the fixture array is out of order", () => {
    const fixture: ReplayFixture = {
      frames: [
        frame("vessel.orbit", { sma: 3 }, 20), // out of order on purpose
        frame("vessel.orbit", { sma: 1 }, 0),
        frame("vessel.orbit", { sma: 2 }, 10),
      ],
    };
    const clock = new FakeClock(100); // anchor at UT 100
    const transport = new ReplayTransport(fixture, { clock });

    const delivered: unknown[] = [];
    transport.onMessage((message) => {
      if (message.type === "stream-data") delivered.push(message.payload);
    });

    expect(delivered).toEqual([]);

    clock.advanceTo(100); // offset 0 -> sma:1
    expect(delivered).toEqual([{ sma: 1 }]);

    clock.advanceTo(109); // still before offset 10
    expect(delivered).toEqual([{ sma: 1 }]);

    clock.advanceTo(110); // offset 10 -> sma:2
    expect(delivered).toEqual([{ sma: 1 }, { sma: 2 }]);

    clock.advanceTo(120); // offset 20 -> sma:3
    expect(delivered).toEqual([{ sma: 1 }, { sma: 2 }, { sma: 3 }]);
  });

  it("stop() cancels every pending delivery", () => {
    const fixture: ReplayFixture = {
      frames: [
        frame("vessel.orbit", { sma: 1 }, 0),
        frame("vessel.orbit", { sma: 2 }, 10),
      ],
    };
    const clock = new FakeClock();
    const transport = new ReplayTransport(fixture, { clock });
    const delivered: unknown[] = [];
    transport.onMessage((message) => {
      if (message.type === "stream-data") delivered.push(message.payload);
    });

    transport.stop();
    clock.advanceTo(100);
    expect(delivered).toEqual([]);
  });

  it("provider mounted with a ReplayTransport streams the fixture's topics and produces the recorded values — the no-KSP iteration engine end to end", () => {
    const fixture: ReplayFixture = {
      subscribedTopics: ["vessel.orbit"],
      frames: [
        frame("vessel.orbit", { sma: 700_000 }, 0),
        frame("vessel.orbit", { sma: 750_000 }, 5),
      ],
    };
    const clock = new FakeClock();
    const transport = new ReplayTransport(fixture, { clock });
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    client.attachStore(store);
    client.subscribe("vessel.orbit", () => {});

    clock.advanceTo(0);
    store.beginFrame();
    expect(store.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(
      700_000,
    );

    clock.advanceTo(5);
    store.beginFrame();
    expect(store.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(
      750_000,
    );
  });
});
