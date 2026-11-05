import { describe, expect, it, vi } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import { PerfBudget } from "../perf/PerfBudget";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

class ManualClock implements Clock {
  private time = 0;
  private readonly timers = new Set<{ at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  schedule(at: number, fn: () => void) {
    const timer = { at, fn };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }
  advance(seconds: number) {
    const end = this.time + seconds;
    for (;;) {
      const next = [...this.timers]
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers.delete(next);
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    this.time = end;
  }
}

class SilentTransport implements Transport {
  status: TransportStatus = "connected";
  readonly sent: ClientMessage[] = [];
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send(message: ClientMessage) {
    this.sent.push(message);
  }
  onMessage(listener: (m: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

const meta = makeMeta();

function setup(delay: { value: number }) {
  const transport = new SilentTransport();
  const clock = new ManualClock();
  const client = new TelemetryClient(transport, clock, { idPrefix: "t" });
  client.setDelaySource(() => delay.value);
  return { transport, clock, client };
}

function outcome(promise: Promise<unknown>) {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

describe("a command sent while the delay is unknown", () => {
  it("is called lost from its dispatch once the figure arrives", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delay = { value: Number.POSITIVE_INFINITY };
    const { transport, clock, client } = setup(delay);
    const { result } = client.dispatch("x.do");
    const state = outcome(result);
    expect(warn.mock.calls[0]?.[0]).toContain("not yet known");
    clock.advance(2);
    delay.value = 5;
    transport.deliver({
      type: "stream-data",
      topic: "comms.delay",
      payload: {},
      meta,
    });
    clock.advance(10);
    await Promise.resolve();
    expect(state.settled).toBe(false);
    clock.advance(2);
    await Promise.resolve();
    expect(state.settled).toBe(true);
    warn.mockRestore();
  });

  it("is called lost after the fallback when no figure ever arrives", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delay = { value: Number.POSITIVE_INFINITY };
    const { clock, client } = setup(delay);
    const { result } = client.dispatch("x.do");
    const state = outcome(result);
    clock.advance(119);
    await Promise.resolve();
    expect(state.settled).toBe(false);
    clock.advance(2);
    await Promise.resolve();
    expect(state.settled).toBe(true);
    warn.mockRestore();
  });

  it("stops counting a command whose record was swept after it was answered with no figure known", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delay = { value: Number.POSITIVE_INFINITY };
    const { transport, client } = setup(delay);
    for (let i = 0; i < 600; i += 1) {
      const { requestId, result } = client.dispatch("x.do");
      result.catch(() => {});
      transport.deliver({
        type: "command-response",
        requestId,
        result: "ran",
        meta,
      });
    }
    client.dispatch("x.do").result.catch(() => {});
    const stillTracked = [...client["commands"].values()].filter(
      (c) => c.awaitingDelay,
    ).length;
    expect(client["awaitingDelayCount"]).toBe(stillTracked);
    for (const budget of PerfBudget.getAll()) budget.reset();
    warn.mockRestore();
  });
});
