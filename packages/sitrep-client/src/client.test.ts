import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { makeMeta, StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import type { Transport, TransportStatus } from "./transport";
import { ViewClock } from "./view-clock";

/**
 * Minimal deterministic `Clock` test double. Mirrors sitrep-server's
 * `ManualClock` semantics (time only moves on `advanceTo`, never reads
 * wall-clock time) without sitrep-client taking a dependency on that
 * package — the two stay structurally compatible by design, not by import.
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

  advanceTo(ut: number): void {
    this.currentUt = ut;
    const due = this.pending.filter((cb) => !cb.cancelled && cb.atUt <= ut);
    this.pending = this.pending.filter((cb) => cb.cancelled || cb.atUt > ut);
    for (const cb of due) cb.fn();
  }
}

/**
 * Minimal `Transport` test double that predicts a fixed `etaConfirm` and
 * lets the test deliver responses on demand — `StubTransport` deliberately
 * doesn't implement `predictConfirmEta` (that shape is covered under test
 * elsewhere), and its microtask-based auto-response can't be held open long
 * enough to exercise the loss-inference window.
 */
class EtaTransport implements Transport {
  readonly status: TransportStatus = "connected";
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();

  constructor(private readonly eta: number | undefined) {}

  predictConfirmEta(): number | undefined {
    return this.eta;
  }

  send(): void {
    // Test drives responses manually via `deliver`.
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(): () => void {
    return () => {};
  }

  deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

describe("TelemetryClient subscriptions", () => {
  it("sends subscribe on first subscriber, fans out values, replays sticky value to late subscribers", () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);
    const a: unknown[] = [];
    const off = client.subscribe("v.alt", (x) => a.push(x));
    expect(sendSpy).toHaveBeenCalledWith({ type: "subscribe", topic: "v.alt" });
    t.emit("v.alt", 10);
    expect(a).toEqual([10]);
    expect(client.getValue("v.alt")).toBe(10);
    const b: unknown[] = [];
    client.subscribe("v.alt", (x) => b.push(x)); // late subscriber gets sticky last value
    expect(b).toEqual([10]);
    off();
  });
  it("sends unsubscribe only when the last subscriber leaves (ref-counted)", () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);
    const off1 = client.subscribe("v.alt", () => {});
    const off2 = client.subscribe("v.alt", () => {});
    off1();
    expect(sendSpy).not.toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
    off2();
    expect(sendSpy).toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
  });

  it("ref-counts by subscription record, not callback identity, when the same callback is passed twice", () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);
    const cb = vi.fn();
    const off1 = client.subscribe("v.alt", cb);
    const off2 = client.subscribe("v.alt", cb);
    off1();
    expect(sendSpy).not.toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
    off2();
    expect(sendSpy).toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
  });

  it("isolates a throwing subscriber so sibling subscribers and store listeners still fire", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const normal = vi.fn();
    const storeListener = vi.fn();
    client.subscribe("v.alt", throwing);
    client.subscribe("v.alt", normal);
    client.subscribeStore(storeListener);

    expect(() => t.emit("v.alt", 42)).not.toThrow();

    expect(throwing).toHaveBeenCalledWith(42);
    expect(normal).toHaveBeenCalledWith(42);
    expect(storeListener).toHaveBeenCalledTimes(1);
  });
});

describe("TelemetryClient.attachStore — feeds the wire into a TimelineStore (M2 bridge task, Fix 1 item 1)", () => {
  function makeStore(): TimelineStore {
    return new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
  }

  it("ingests every stream-data frame into an attached store", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const store = makeStore();
    client.attachStore(store);

    client.subscribe("vessel.orbit", () => {});
    t.emit("vessel.orbit", { sma: 700_000 });
    store.beginFrame();

    expect(store.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(
      700_000,
    );
  });

  it("feeds every attached store, not just the first", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const storeA = makeStore();
    const storeB = makeStore();
    client.attachStore(storeA);
    client.attachStore(storeB);

    client.subscribe("vessel.orbit", () => {});
    t.emit("vessel.orbit", { sma: 1 });
    storeA.beginFrame();
    storeB.beginFrame();

    expect(storeA.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(1);
    expect(storeB.sample<{ sma: number }>("vessel.orbit")?.payload.sma).toBe(1);
  });

  it("detaching stops feeding that store, without affecting other subscribers", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const store = makeStore();
    const detach = client.attachStore(store);

    client.subscribe("vessel.orbit", () => {});
    detach();
    t.emit("vessel.orbit", { sma: 2 });
    store.beginFrame();

    expect(store.sample<{ sma: number }>("vessel.orbit")).toBeUndefined();
  });

  it("stamps the ingested point's validAt/epoch from the message's own meta", () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const store = makeStore();
    client.attachStore(store);

    client.subscribe("vessel.orbit", () => {});
    t.emitRaw({
      type: "stream-data",
      topic: "vessel.orbit",
      payload: { sma: 3 },
      meta: makeMeta({ validAt: 42, timelineEpoch: 0 }),
    });
    store.beginFrame();

    const point = store.getTimeline<{ sma: number }>("vessel.orbit").latest();
    expect(point?.validAt).toBe(42);
    expect(point?.epoch).toBe(0);
  });
});

describe("TelemetryClient commands", () => {
  it("dispatch sends a command-request, resolves on the correlated response, tracks lifecycle", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c, a) => ({ ok: c, a }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("deploy", 7);
    // StubTransport doesn't implement predictConfirmEta, so etaConfirm falls
    // back to "now" (real wall-clock time from the default RealTimeClock) —
    // not asserted precisely here, just that the rest of the shape holds.
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "in-flight",
      requestId,
    });
    await expect(result).resolves.toEqual({ ok: "deploy", a: 7 });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy", a: 7 },
    });
  });
  it("rejects + marks failed when the transport returns an error for the requestId", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    // make the stub answer with an error for any command:
    t.setCommandHandler(() => {
      throw { code: "E_NO", message: "nope" };
    });
    const { requestId, result } = client.dispatch("x");
    await expect(result).rejects.toMatchObject({ code: "E_NO" });
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "failed",
      requestId,
    });
  });

  it("retains the command-map entry after settle: getCommand keeps returning the terminal status, not idle", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c) => ({ ok: c }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("deploy");
    await result;

    const first = client.getCommand(requestId);
    expect(first).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
    // Reading again must return the same terminal status, not a fresh
    // `{ phase: "idle" }` — that reversion is exactly what breaks
    // useSyncExternalStore's getSnapshot stability.
    expect(client.getCommand(requestId)).toEqual(first);
  });

  it("ignores a duplicate/late command-response for an already-settled requestId instead of clobbering the terminal status", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c) => ({ ok: c }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("deploy");
    await result;

    expect(() =>
      t.emitRaw({
        type: "command-response",
        requestId,
        result: { ok: "duplicate" },
        meta: makeMeta(),
      } satisfies ServerMessage),
    ).not.toThrow();

    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });

  it("dispose() rejects every still-pending command and sends unsubscribe for every active topic", async () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);

    client.subscribe("v.alt", () => {});
    client.subscribe("v.speed", () => {});
    // No command handler installed, so dispatch's transport-side response
    // never arrives synchronously — dispose() runs before it ever would.
    const { requestId, result } = client.dispatch("deploy");
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "in-flight",
      requestId,
    });

    client.dispose();

    await expect(result).rejects.toMatchObject({ code: "E_DISPOSED" });
    expect(sendSpy).toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
    expect(sendSpy).toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.speed",
    });
  });
});

describe("TelemetryClient delayed command lifecycle (eta + loss)", () => {
  it("carries the transport's predicted etaConfirm on the in-flight status", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId } = client.dispatch("deploy");

    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });
  });

  it("does not infer loss before etaConfirm + LOSS_MARGIN", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId } = client.dispatch("deploy");
    clock.advanceTo(4 + LOSS_MARGIN - 0.001);

    expect(client.getCommand(requestId)).toMatchObject({ phase: "in-flight" });
  });

  it("infers lost + rejects on silence past etaConfirm + LOSS_MARGIN", async () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    clock.advanceTo(4 + LOSS_MARGIN);

    await expect(result).rejects.toMatchObject({ code: "E_LOST" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "lost",
      requestId,
      reason: "signal-lost",
    });
  });

  it("cancels the loss timer on confirm: a settled command never later flips to lost", async () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    transport.deliver({
      type: "command-response",
      requestId,
      result: { ok: true },
      meta: makeMeta(),
    });
    await expect(result).resolves.toEqual({ ok: true });

    // Well past the would-be loss deadline: status must still be confirmed.
    clock.advanceTo(4 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: true },
    });
  });

  it("cancels the loss timer on error: a failed command never later flips to lost", async () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    transport.deliver({
      type: "error",
      requestId,
      code: "E_NO",
      message: "nope",
    });
    await expect(result).rejects.toMatchObject({ code: "E_NO" });

    clock.advanceTo(4 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "failed",
      requestId,
    });
  });

  it("StubTransport (no predictConfirmEta) still dispatches immediately with no false loss", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c) => ({ ok: c }));
    const clock = new FakeClock(0);
    const client = new TelemetryClient(t, clock);

    const { requestId, result } = client.dispatch("deploy");
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 0,
    });

    // No loss timer was ever scheduled (predictConfirmEta is undefined), so
    // advancing time — even far past any plausible deadline — must not
    // flip this to lost before the stub's microtask response arrives.
    clock.advanceTo(1000);
    await expect(result).resolves.toEqual({ ok: "deploy" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });
});
