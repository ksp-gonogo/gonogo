import { StubTransport } from "@ksp-gonogo/sitrep-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUplinkRoster } from "./rosterProbe";

function rosterPayload(): unknown {
  return {
    uplinks: [
      {
        id: "scansat",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-abc",
        health: { state: 0, detail: null },
      },
      {
        id: "kos",
        version: "0.2.0",
        available: false,
        reason: "no active CPU",
        expectedClientHash: null,
        health: { state: 2, detail: "no active CPU" },
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeUplinkRoster", () => {
  it("resolves the decoded roster with expectedClientHash carried", async () => {
    const stub = new StubTransport();
    const pending = probeUplinkRoster({ transport: stub, timeoutMs: 1000 });
    // The probe subscribes synchronously in the Promise executor, so the topic
    // is live before we emit.
    stub.emit("system.uplinks", rosterPayload());

    const roster = await pending;
    expect(roster).toEqual([
      {
        id: "scansat",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-abc",
      },
      {
        id: "kos",
        version: "0.2.0",
        available: false,
        reason: "no active CPU",
        expectedClientHash: null,
      },
    ]);
  });

  it("tears down its subscription after resolving", async () => {
    const stub = new StubTransport();
    const pending = probeUplinkRoster({ transport: stub, timeoutMs: 1000 });
    stub.emit("system.uplinks", rosterPayload());
    await pending;
    // client.dispose() (finally block) unsubscribes every topic — proves the
    // one-shot boot read cleaned up after itself.
    expect(stub.isSubscribed("system.uplinks")).toBe(false);
  });

  it("resolves undefined (never rejects) when no sample arrives before the timeout", async () => {
    vi.useFakeTimers();
    const stub = new StubTransport();
    const pending = probeUplinkRoster({ transport: stub, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeUndefined();
  });

  it("ignores a tombstone (null payload) and falls back to undefined on timeout", async () => {
    vi.useFakeTimers();
    const stub = new StubTransport();
    const pending = probeUplinkRoster({ transport: stub, timeoutMs: 3000 });
    stub.emit("system.uplinks", null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeUndefined();
  });
});
