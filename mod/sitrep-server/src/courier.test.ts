import type { CommandResponse, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "./clock";
import { Courier } from "./courier";
import { StubNetwork } from "./stub-network";

describe("Courier", () => {
  it("delivers a recorded sample to a subscriber at validAt + delay, not before", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    const received: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    courier.record("vessel", "alt", 100, 0);

    // Not delivered before the delay elapses.
    clock.advanceTo(1);
    expect(received).toHaveLength(0);

    // Delivered exactly when UT reaches validAt + delay.
    clock.advanceTo(2);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "stream-data",
      topic: "alt",
      payload: 100,
      meta: {
        source: "vessel",
        validAt: 0,
        deliveredAt: 2,
        vantage: "KSC",
      },
    });
  });

  it("delivers the same sample to two vantages independently, each at its own delay", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    network.setDelay("DSN", "vessel", 5);
    const courier = new Courier({ clock, network });

    const kscReceived: StreamData<unknown>[] = [];
    const dsnReceived: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      kscReceived.push(msg);
    });
    courier.subscribeStream("vessel", "alt", "DSN", (msg) => {
      dsnReceived.push(msg);
    });

    courier.record("vessel", "alt", 100, 0);

    clock.advanceTo(2);
    expect(kscReceived).toHaveLength(1);
    expect(kscReceived[0].meta.vantage).toBe("KSC");
    expect(dsnReceived).toHaveLength(0);

    clock.advanceTo(5);
    expect(dsnReceived).toHaveLength(1);
    expect(dsnReceived[0].meta.vantage).toBe("DSN");
    expect(dsnReceived[0].payload).toBe(100);
    // KSC does not get a second, duplicate delivery of the same sample.
    expect(kscReceived).toHaveLength(1);
  });

  it("catches up a late subscriber joining after a sample has already arrived", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    courier.record("vessel", "alt", 100, 0);
    clock.advanceTo(3);

    const received: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    // Catch-up delivery happens synchronously on subscribe, no clock advance needed.
    expect(received).toHaveLength(1);
    expect(received[0].payload).toBe(100);
    expect(received[0].meta.validAt).toBe(0);
    expect(received[0].meta.deliveredAt).toBe(3);
  });

  it("does not deliver anything to a subscriber that unsubscribed before the delay elapsed", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    const received: StreamData<unknown>[] = [];
    const unsub = courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    courier.record("vessel", "alt", 100, 0);
    unsub();

    clock.advanceTo(2);
    expect(received).toHaveLength(0);
  });

  it("assigns a per-courier monotonically increasing seq to each delivered sample", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    const courier = new Courier({ clock, network });

    const received: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    courier.record("vessel", "alt", 100, 0);
    clock.advanceTo(0);
    courier.record("vessel", "alt", 200, 1);
    clock.advanceTo(1);

    expect(received).toHaveLength(2);
    expect(received[1].meta.seq).toBeGreaterThan(received[0].meta.seq);
  });

  it("delivers to a subscriber that joins while a sample is still in flight", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    courier.record("vessel", "alt", 100, 0);

    // In flight: recorded at UT0 with a 2s delay, so it hasn't arrived at UT1.
    clock.advanceTo(1);

    const received: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    // No catch-up available yet (sample hasn't arrived) — must not be lost.
    expect(received).toHaveLength(0);

    clock.advanceTo(2);
    expect(received).toHaveLength(1);
    expect(received[0].payload).toBe(100);
    expect(received[0].meta.validAt).toBe(0);
    expect(received[0].meta.deliveredAt).toBe(2);
  });

  it("delivers every sample exactly once, in order, when a single advanceTo jump drains multiple deliveries", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    const received: StreamData<unknown>[] = [];
    courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
      received.push(msg);
    });

    courier.record("vessel", "alt", 0, 0);
    courier.record("vessel", "alt", 1, 1);

    // Single big time-warp jump spanning both arrivals (UT2 and UT3).
    clock.advanceTo(5);

    expect(received).toHaveLength(2);
    expect(received[0].payload).toBe(0);
    expect(received[0].meta.validAt).toBe(0);
    expect(received[0].meta.deliveredAt).toBe(2);
    expect(received[1].payload).toBe(1);
    expect(received[1].meta.validAt).toBe(1);
    expect(received[1].meta.deliveredAt).toBe(3);
  });

  describe("delay-0 collapse (scale 0 == M2 parity)", () => {
    it("delivers a stream sample with no lag: deliveredAt === validAt", () => {
      const clock = new ManualClock();
      const network = new StubNetwork();
      // A large configured base delay that scale 0 must still zero out.
      network.setDelay("KSC", "vessel", 100);
      network.setScale(0);
      const courier = new Courier({ clock, network });

      const received: StreamData<unknown>[] = [];
      courier.subscribeStream("vessel", "alt", "KSC", (msg) => {
        received.push(msg);
      });

      courier.record("vessel", "alt", 42, 5);
      clock.advanceTo(5);

      expect(received).toHaveLength(1);
      expect(received[0].payload).toBe(42);
      expect(received[0].meta.validAt).toBe(5);
      expect(received[0].meta.deliveredAt).toBe(5);
    });

    it("confirms a dispatched command at t0 with zero round-trip delay (next advanceTo(t0) tick)", () => {
      const clock = new ManualClock();
      const network = new StubNetwork();
      network.setDelay("KSC", "vessel", 100);
      network.setScale(0);
      const courier = new Courier({ clock, network });

      const handler = vi.fn((command: string) => ({ ok: command }));
      courier.setCommandHandler(handler);

      const onResponse = vi.fn();
      courier.dispatchCommand(
        "vessel",
        "r1",
        "deploy",
        null,
        "KSC",
        onResponse,
      );

      // Dispatch and confirmation land at the same t0 — neither fires
      // synchronously on dispatch (the schedule() seam still applies), but
      // both are due and fire together on the next advanceTo(t0) tick.
      expect(handler).not.toHaveBeenCalled();
      expect(onResponse).not.toHaveBeenCalled();

      clock.advanceTo(0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledTimes(1);
      const response = onResponse.mock.calls[0][0] as CommandResponse<unknown>;
      expect(response.meta.validAt).toBe(0);
      expect(response.meta.deliveredAt).toBe(0);
    });
  });
});
