import type { ServerMessage, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandErrorCode,
  classifyCommandRejection,
} from "@ksp-gonogo/sitrep-sdk";
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
 * package: the two stay structurally compatible by design, not by import.
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
 * lets the test deliver responses on demand, `StubTransport` deliberately
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

  it("setVantage sends set-vantage, tracks selectedVantage, and re-subscribes active topics", () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);
    expect(client.selectedVantage).toBe("ksc");

    client.subscribe("v.alt", () => {});
    sendSpy.mockClear();

    client.setVantage("ground:gs1");
    expect(client.selectedVantage).toBe("ground:gs1");
    expect(sendSpy).toHaveBeenCalledWith({
      type: "set-vantage",
      centreId: "ground:gs1",
    });
    // The active topic re-subscribes so its cursor re-points to the new vantage.
    expect(sendSpy).toHaveBeenCalledWith({
      type: "unsubscribe",
      topic: "v.alt",
    });
    expect(sendSpy).toHaveBeenCalledWith({ type: "subscribe", topic: "v.alt" });
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

describe("TelemetryClient.attachStore: feeds the wire into a TimelineStore (M2 bridge task, Fix 1 item 1)", () => {
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

    // `.magnitude`: the transport wraps on the way out, same as the wire
    // decode does, so a store holds quantities rather than bare numbers.
    expect(
      store.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma.magnitude,
    ).toBe(700_000);
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

    expect(
      storeA.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(1);
    expect(
      storeB.sample<{ sma: Value<"m"> }>("vessel.orbit")?.payload?.sma
        .magnitude,
    ).toBe(1);
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
    // back to "now" (real wall-clock time from the default RealTimeClock),
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
  it("dispatch threads the per-call vantage into the command-request", () => {
    const t = new StubTransport();
    const sendSpy = vi.spyOn(t, "send");
    const client = new TelemetryClient(t);
    client.dispatch(
      "career.tech.unlock",
      { id: "n" },
      undefined,
      undefined,
      "meta",
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command-request",
        command: "career.tech.unlock",
        vantage: "meta",
      }),
    );
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
    // `{ phase: "idle" }`, that reversion is exactly what breaks
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
    // never arrives synchronously: dispose() runs before it ever would.
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
    // advancing time, even far past any plausible deadline, must not
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

/**
 * The channel a transport reports SOMEONE ELSE'S loss on.
 *
 * `PeerTransport` is the case: a station's command is dispatched to the mod by
 * the host, so the host's loss timer is the only one timing that leg. Relayed as
 * an `error` frame instead, the host saying "I stopped waiting" would arrive as
 * proof the mod received the command, because that is what an `error` correlated
 * to a requestId means (`handleCommandError` moves a lost command to `found` on
 * one). Hence a channel rather than a reserved code.
 */
describe("TelemetryClient: a loss relayed by the transport", () => {
  class RelayingTransport implements Transport {
    readonly status: TransportStatus = "connected";
    private readonly messageListeners = new Set<
      (message: ServerMessage) => void
    >();
    private readonly lostListeners = new Set<
      (command: { requestId: string; reason: string }) => void
    >();

    constructor(private readonly eta: number | undefined) {}

    predictConfirmEta(): number | undefined {
      return this.eta;
    }

    send(): void {
      // The test drives every reply.
    }

    onMessage(listener: (message: ServerMessage) => void): () => void {
      this.messageListeners.add(listener);
      return () => this.messageListeners.delete(listener);
    }

    onStatusChange(): () => void {
      return () => {};
    }

    onLost(
      listener: (command: { requestId: string; reason: string }) => void,
    ): () => void {
      this.lostListeners.add(listener);
      return () => this.lostListeners.delete(listener);
    }

    relayLoss(requestId: string, reason: string): void {
      for (const listener of this.lostListeners)
        listener({ requestId, reason });
    }

    deliver(message: ServerMessage): void {
      for (const listener of this.messageListeners) listener(message);
    }
  }

  it("settles a still-waiting dispatch as lost, not failed", async () => {
    // No prediction, so nothing here arms a deadline of its own: the relay's
    // verdict is the only thing that can end this wait.
    const transport = new RelayingTransport(undefined);
    const client = new TelemetryClient(transport, new FakeClock(0));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      (error: unknown) => classifyCommandRejection(error),
    );
    transport.relayLoss(requestId, "no confirmation by ETA");

    // `lost`, which warns that a re-send may double a command the mod may
    // already have run. `failed` would promise a safe retry instead.
    expect(client.getCommand(requestId)).toEqual({
      phase: "lost",
      requestId,
      reason: "relayed-loss",
    });
    expect(await settled).toMatchObject({ kind: "lost" });
    warn.mockRestore();
  });

  it("leaves an already-lost command lost: the relay is agreeing, not answering", async () => {
    const clock = new FakeClock(0);
    const transport = new RelayingTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      (error: unknown) => classifyCommandRejection(error),
    );
    clock.advanceTo(4 + LOSS_MARGIN);
    expect(client.getCommand(requestId).phase).toBe("lost");
    expect(await settled).toMatchObject({ kind: "lost" });

    transport.relayLoss(requestId, "no confirmation by ETA");

    expect(client.getCommand(requestId).phase).toBe("lost");
    // The phase this defect produced. An `error` frame carrying `E_LOST` is
    // read as the mod having answered, so the host reporting its own ignorance
    // told the station the command had run.
    expect(client.getCommand(requestId).phase).not.toBe("found");
  });

  it("cannot unmake an answer: a relayed loss for a confirmed command changes nothing", async () => {
    const clock = new FakeClock(0);
    const transport = new RelayingTransport(4);
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    transport.deliver({
      type: "command-response",
      requestId,
      result: { ok: true },
      meta: makeMeta(),
    });
    await expect(result).resolves.toEqual({ ok: true });

    transport.relayLoss(requestId, "no confirmation by ETA");

    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: true },
    });
  });

  it("stops listening on dispose, so a late relayed loss reaches nothing", async () => {
    const transport = new RelayingTransport(undefined);
    const client = new TelemetryClient(transport, new FakeClock(0));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      (error: unknown) => classifyCommandRejection(error),
    );
    client.dispose();
    expect(await settled).toMatchObject({ kind: "failed" });

    // Nothing to throw at: `dispose` already emptied the correlation map, and
    // the listener is detached, so this must not resurrect a status either.
    transport.relayLoss(requestId, "no confirmation by ETA");
    expect(client.getCommand(requestId)).toEqual({ phase: "idle" });
    warn.mockRestore();
  });
});

/**
 * A command the mod REFUSED is not a command that worked. The mod answers a
 * well-formed refusal on the normal `command-response` channel, carrying a
 * typed `CommandResult.errorCode`; the `"error"` message type is reserved for
 * a different class entirely (handler exception, unserializable result). So
 * "the handler ran and said no" and "the machinery broke" arrive by different
 * routes on purpose, and the client must not collapse them.
 */
describe("TelemetryClient command refusals", () => {
  const refusing = (errorCode: CommandErrorCode) => {
    const t = new StubTransport();
    t.setCommandHandler(() => ({ success: false, errorCode }));
    return t;
  };

  it("does not read a refusal as confirmed", async () => {
    const t = refusing(CommandErrorCode.NoVessel);
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("vessel.maneuver.add");

    await expect(result).rejects.toMatchObject({
      code: "E_REFUSED",
      errorCode: CommandErrorCode.NoVessel,
    });
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "refused",
      requestId,
      errorCode: CommandErrorCode.NoVessel,
    });
  });

  it("names the command it dispatched, so a refusal is not anonymous", async () => {
    // The reply carries a requestId and a reason and deliberately no command
    // name, so the only place the name still exists is the client's own pending
    // record, which used to drop it. Every refusal of every command in the mod
    // therefore read "command refused: ModeUnavailable" and an operator could
    // not tell which control had said no.
    const client = new TelemetryClient(refusing(CommandErrorCode.LimitReached));
    const { requestId, result } = client.dispatch(
      "career.crew.hire",
      { applicantName: "Valentina Kerman" },
      "Hire Valentina Kerman",
    );

    const err = await result.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      code: "E_REFUSED",
      command: "career.crew.hire",
      args: { applicantName: "Valentina Kerman" },
      label: "Hire Valentina Kerman",
    });
    expect((err as Error).message).toContain("career.crew.hire");
    expect(client.getCommand(requestId)).toMatchObject({
      phase: "refused",
      command: "career.crew.hire",
      label: "Hire Valentina Kerman",
    });
  });

  it("carries the refusal's numbers through, and carries none when there are none", async () => {
    // A code with no payload cannot say "16 of 16"; a breach with no code does
    // not say which sentence it belongs in. Both, or neither.
    const withNumbers = new StubTransport();
    withNumbers.setCommandHandler(() => ({
      success: false,
      errorCode: CommandErrorCode.LimitReached,
      breach: {
        facility: "AstronautComplex",
        facilityName: "Astronaut Complex",
        quantity: "activeCrew",
        limit: 16,
        actual: 16,
        unit: "count",
      },
    }));
    const client = new TelemetryClient(withNumbers);
    const { result } = client.dispatch("career.crew.hire");
    await expect(result).rejects.toMatchObject({
      breach: { facilityName: "Astronaut Complex", limit: 16, actual: 16 },
    });

    // An older mod, or an arm with nothing to compare: absent, never zeroes.
    const bare = new TelemetryClient(refusing(CommandErrorCode.NoVessel));
    const err = await bare.dispatch("vessel.control.stage").result.then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as { breach?: unknown }).breach).toBeUndefined();
  });

  it("keeps a refusal distinct from a malfunction: the phase says which happened", async () => {
    const refused = new TelemetryClient(
      refusing(CommandErrorCode.ModeUnavailable),
    );
    const { requestId: refusedId, result: refusedResult } = refused.dispatch(
      "vessel.control.stage",
    );
    await expect(refusedResult).rejects.toMatchObject({ code: "E_REFUSED" });

    const broken = new StubTransport();
    broken.setCommandHandler(() => {
      throw { code: "E_BOOM", message: "handler exploded" };
    });
    const malfunction = new TelemetryClient(broken);
    const { requestId: failedId, result: failedResult } = malfunction.dispatch(
      "vessel.control.stage",
    );
    await expect(failedResult).rejects.toMatchObject({ code: "E_BOOM" });

    // Same command, both terminal, both unsuccessful, and a UI that wants to
    // say "the game said no" vs "something broke" can tell them apart.
    expect(refused.getCommand(refusedId).phase).toBe("refused");
    expect(malfunction.getCommand(failedId).phase).toBe("failed");
  });

  it("still confirms a successful CommandResult", async () => {
    const t = new StubTransport();
    t.setCommandHandler(() => ({
      success: true,
      errorCode: CommandErrorCode.None,
    }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("vessel.control.stage");

    await expect(result).resolves.toMatchObject({ success: true });
    expect(client.getCommand(requestId).phase).toBe("confirmed");
  });

  it("still confirms a result that is not CommandResult-shaped at all", async () => {
    // Not every command-response payload is a `CommandResult`: an Uplink may
    // answer with a shape of its own. Absence of `success` is not a refusal,
    // and reading it as one would break every such command.
    const t = new StubTransport();
    t.setCommandHandler((c) => ({ ok: c, stdout: "" }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("uplink.own.shape");

    await expect(result).resolves.toMatchObject({ ok: "uplink.own.shape" });
    expect(client.getCommand(requestId).phase).toBe("confirmed");
  });

  it("rejects with a real Error, so a caller rendering the reason gets words", async () => {
    // `ManeuverPlanner` reports a partial dispatch with
    // `err instanceof Error ? err.message : String(err)`. A plain object
    // rejection renders as "[object Object]" in the operator's face.
    const client = new TelemetryClient(refusing(CommandErrorCode.PlanNotOwned));
    const { result } = client.dispatch("vessel.maneuver.add");

    const err = await result.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const reason = err instanceof Error ? err.message : String(err);
    expect(reason).not.toContain("[object Object]");
    expect(reason).toMatch(/refus/i);
  });
});

/**
 * The published guard and the spine that throws are two files that have to
 * agree about three strings. They share the code constants, which stops one
 * kind of drift; this covers the other kind, where a phase is renamed or a
 * rejection starts carrying something else, by running both halves end to end
 * and asserting they still describe the same outcome.
 */
describe("classifyCommandRejection against the spine that actually throws", () => {
  const classify = (result: Promise<unknown>) =>
    result.then(
      () => null,
      (err: unknown) => classifyCommandRejection(err),
    );

  it("agrees with the recorded phase on all three terminal outcomes", async () => {
    const refusing = new StubTransport();
    refusing.setCommandHandler(() => ({
      success: false,
      errorCode: CommandErrorCode.NotFound,
    }));
    const refused = new TelemetryClient(refusing);
    const refusedDispatch = refused.dispatch("a");
    expect(await classify(refusedDispatch.result)).toEqual({
      kind: "refused",
      errorCode: CommandErrorCode.NotFound,
      // The typed reason reaches the words too, or an operator-facing message
      // built from this is back to saying nothing useful.
      message: expect.stringContaining("NotFound"),
      // And WHICH command was refused, which the reply itself never says.
      command: "a",
      args: undefined,
      label: "",
      breach: undefined,
    });
    expect(refused.getCommand(refusedDispatch.requestId).phase).toBe("refused");

    const breaking = new StubTransport();
    breaking.setCommandHandler(() => {
      throw { code: "E_NO", message: "nope" };
    });
    const failed = new TelemetryClient(breaking);
    const failedDispatch = failed.dispatch("b");
    expect(await classify(failedDispatch.result)).toEqual({
      kind: "failed",
      code: "E_NO",
      message: "nope",
    });
    expect(failed.getCommand(failedDispatch.requestId).phase).toBe("failed");

    const clock = new FakeClock(0);
    const silent = new EtaTransport(4);
    const lost = new TelemetryClient(silent, clock);
    const lostDispatch = lost.dispatch("c");
    clock.advanceTo(4 + LOSS_MARGIN + 10);
    expect(await classify(lostDispatch.result)).toMatchObject({ kind: "lost" });
    expect(lost.getCommand(lostDispatch.requestId).phase).toBe("lost");
  });

  it("calls an unplaceable throw failed rather than inventing a game reason", async () => {
    // A handler that throws a bare string, or any foreign error: "something
    // broke, a retry may work" is the safe reading. Calling it `refused` would
    // claim the game evaluated something it never saw.
    const t = new StubTransport();
    t.setCommandHandler(() => {
      throw new Error("kaboom");
    });
    const client = new TelemetryClient(t);
    expect(await classify(client.dispatch("d").result)).toMatchObject({
      kind: "failed",
    });
  });
});

/**
 * A command declared lost can still be executed, and the app can still be told
 * so. `handleLoss` retains the correlation entry and `WebSocketTransport` flushes
 * everything it queued while the socket was down, so the reply for a command the
 * operator was told to give up on genuinely does arrive.
 */
describe("TelemetryClient found: a lost command that answers after all", () => {
  /** Dispatch, let the loss deadline pass, swallow the rejection. */
  async function loseOne(command = "deploy") {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);
    const { requestId, result } = client.dispatch(command);
    clock.advanceTo(4 + LOSS_MARGIN);
    await expect(result).rejects.toMatchObject({ code: "E_LOST" });
    return { client, transport, requestId, result };
  }

  it("re-opens a lost command as found when its reply finally arrives", async () => {
    const { client, transport, requestId } = await loseOne();

    transport.deliver({
      type: "command-response",
      requestId,
      result: { success: true, payload: { staged: 3 } },
      meta: makeMeta(),
    });

    expect(client.getCommand(requestId)).toEqual({
      phase: "found",
      requestId,
      outcome: "ran",
      result: { success: true, payload: { staged: 3 } },
    });
  });

  it("notifies the store, so the rail redraws without the promise moving", async () => {
    const { client, transport, requestId, result } = await loseOne();
    const notified = vi.fn();
    client.subscribeStore(notified);

    transport.deliver({
      type: "command-response",
      requestId,
      result: { success: true },
      meta: makeMeta(),
    });

    expect(notified).toHaveBeenCalledTimes(1);
    // The promise settled as lost and stays settled as lost: it is a one-shot
    // await and the caller genuinely did stop waiting.
    await expect(result).rejects.toMatchObject({ code: "E_LOST" });
  });

  it("keeps a late REFUSAL apart from a late success", async () => {
    const { client, transport, requestId } = await loseOne("career.crew.hire");

    transport.deliver({
      type: "command-response",
      requestId,
      result: {
        success: false,
        errorCode: CommandErrorCode.LimitReached,
        breach: { quantity: "activeCrew", limit: 16, actual: 16, unit: "" },
        detail: "The Astronaut Complex is full",
      },
      meta: makeMeta(),
    });

    expect(client.getCommand(requestId)).toMatchObject({
      phase: "found",
      requestId,
      outcome: "refused",
      errorCode: CommandErrorCode.LimitReached,
      detail: "The Astronaut Complex is full",
    });
  });

  it("calls a late error frame found and errored: it proves the mod heard us", async () => {
    const { client, transport, requestId } = await loseOne();

    transport.deliver({
      type: "error",
      requestId,
      code: "E_HANDLER",
      message: "the handler threw",
    });

    expect(client.getCommand(requestId)).toEqual({
      phase: "found",
      requestId,
      outcome: "errored",
      error: { code: "E_HANDLER", message: "the handler threw" },
    });
  });

  it("ignores a DUPLICATE late reply: found is terminal the way lost never was", async () => {
    const { client, transport, requestId } = await loseOne();

    transport.deliver({
      type: "command-response",
      requestId,
      result: { success: true, payload: "first" },
      meta: makeMeta(),
    });
    transport.deliver({
      type: "command-response",
      requestId,
      result: { success: true, payload: "second" },
      meta: makeMeta(),
    });

    expect(client.getCommand(requestId)).toMatchObject({
      outcome: "ran",
      result: { success: true, payload: "first" },
    });
  });

  it("never re-opens a command that settled normally", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const { requestId, result } = client.dispatch("deploy");
    await result;
    expect(client.getCommand(requestId).phase).toBe("confirmed");

    transport.emitRaw({
      type: "command-response",
      requestId,
      result: { success: false, errorCode: CommandErrorCode.WrongState },
      meta: makeMeta(),
    });

    expect(client.getCommand(requestId).phase).toBe("confirmed");
  });
});
