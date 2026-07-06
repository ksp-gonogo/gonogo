import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { StubTransport } from "./stub-transport";

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

describe("TelemetryClient commands", () => {
  it("dispatch sends a command-request, resolves on the correlated response, tracks lifecycle", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c, a) => ({ ok: c, a }));
    const client = new TelemetryClient(t);
    const { requestId, result } = client.dispatch("deploy", 7);
    expect(client.getCommand(requestId)).toEqual({
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
});
