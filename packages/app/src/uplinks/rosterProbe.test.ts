import { StubTransport, TelemetryClient } from "@ksp-gonogo/sitrep-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeRosterPayload,
  probeUplinkRoster,
  readRosterFromTelemetryClient,
} from "./rosterProbe";

// Generic fixture ids on purpose — the probe is Uplink-agnostic, and this file
// must reference no mod token so the uplink-boundary ratchet stays clean.
function rosterPayload(): unknown {
  return {
    uplinks: [
      {
        id: "alpha",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-abc",
        clientSource: { url: "https://cdn.example/alpha.js", devPath: null },
        health: { state: 0, detail: null },
      },
      {
        id: "beta",
        version: "0.2.0",
        available: false,
        reason: "not ready",
        expectedClientHash: null,
        health: { state: 2, detail: "not ready" },
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeUplinkRoster", () => {
  it("resolves the decoded roster with expectedClientHash + clientSource carried", async () => {
    const stub = new StubTransport();
    const pending = probeUplinkRoster({ transport: stub, timeoutMs: 1000 });
    // The probe subscribes synchronously in the Promise executor, so the topic
    // is live before we emit.
    stub.emit("system.uplinks", rosterPayload());

    const roster = await pending;
    expect(roster).toEqual([
      {
        id: "alpha",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-abc",
        // D5 — the client-source declaration is carried through to RosterEntry.
        clientSource: { url: "https://cdn.example/alpha.js", devPath: null },
      },
      {
        id: "beta",
        version: "0.2.0",
        available: false,
        reason: "not ready",
        expectedClientHash: null,
        // A mod-only entry (no clientSource on the wire) decodes to null.
        clientSource: null,
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

describe("decodeRosterPayload", () => {
  it("decodes a valid payload into RosterEntry[] — the same shape probeUplinkRoster resolves", () => {
    expect(decodeRosterPayload(rosterPayload())).toEqual([
      {
        id: "alpha",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-abc",
        clientSource: { url: "https://cdn.example/alpha.js", devPath: null },
      },
      {
        id: "beta",
        version: "0.2.0",
        available: false,
        reason: "not ready",
        expectedClientHash: null,
        clientSource: null,
      },
    ]);
  });

  it("returns undefined for null (tombstone)", () => {
    expect(decodeRosterPayload(null)).toBeUndefined();
  });

  it("returns undefined for a non-object value", () => {
    expect(decodeRosterPayload("not a roster")).toBeUndefined();
    expect(decodeRosterPayload(42)).toBeUndefined();
  });

  it("returns undefined when uplinks isn't an array", () => {
    expect(decodeRosterPayload({ uplinks: "nope" })).toBeUndefined();
    expect(decodeRosterPayload({})).toBeUndefined();
  });
});

describe("readRosterFromTelemetryClient", () => {
  it("resolves the decoded roster from a system.uplinks frame arriving after subscribe", async () => {
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const pending = readRosterFromTelemetryClient(client, 1000);
    // The function subscribes synchronously before returning its promise, so
    // the topic is live before we emit.
    stub.emit("system.uplinks", rosterPayload());

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ id: "alpha", available: true }),
      expect.objectContaining({ id: "beta", available: false }),
    ]);
  });

  it("resolves immediately from an already-cached sticky value (mirrors SitrepPeerRelay's backfill) without a TDZ crash on the synchronous callback", async () => {
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    // Simulate the roster having already arrived before this reader ever
    // subscribes (SitrepPeerRelay backfills the last frame to a newly
    // connecting station) — a persistent subscriber keeps the topic "live"
    // on the stub and populates TelemetryClient's own sticky lastValues cache.
    const keepAlive = client.subscribe("system.uplinks", () => {});
    stub.emit("system.uplinks", rosterPayload());

    // TelemetryClient.subscribe() invokes the callback SYNCHRONOUSLY when a
    // sticky value already exists — this is the exact path that would throw
    // "Cannot access 'unsub' before initialization" if `unsub` were declared
    // with `const` instead of a pre-assigned `let`.
    const roster = await readRosterFromTelemetryClient(client, 1000);
    expect(roster).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "alpha" })]),
    );

    keepAlive();
  });

  it("unsubscribes its own borrow but leaves another subscriber's subscription intact", async () => {
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const keepAlive = client.subscribe("system.uplinks", () => {});
    stub.emit("system.uplinks", rosterPayload());

    await readRosterFromTelemetryClient(client, 1000);

    // The persistent subscriber is still there, so the transport-level
    // subscription must still be live — only when the LAST subscriber
    // unsubscribes does TelemetryClient send `unsubscribe` on the wire.
    expect(stub.isSubscribed("system.uplinks")).toBe(true);
    keepAlive();
    expect(stub.isSubscribed("system.uplinks")).toBe(false);
  });

  it("does not dispose the borrowed client — it keeps working for further subscriptions afterwards", async () => {
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const pending = readRosterFromTelemetryClient(client, 1000);
    stub.emit("system.uplinks", rosterPayload());
    await pending;

    const received: unknown[] = [];
    const unsub = client.subscribe("vessel.orbit", (v) => received.push(v));
    stub.emit("vessel.orbit", { apoapsis: 100_000 });
    expect(received).toEqual([{ apoapsis: 100_000 }]);
    unsub();
  });

  it("resolves undefined (never rejects) when no sample arrives before the timeout", async () => {
    vi.useFakeTimers();
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const pending = readRosterFromTelemetryClient(client, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeUndefined();
    // The timeout path unsubscribes too — no dangling subscription left on
    // the shared client after a degraded (no-mod-talking) boot.
    expect(stub.isSubscribed("system.uplinks")).toBe(false);
  });
});
