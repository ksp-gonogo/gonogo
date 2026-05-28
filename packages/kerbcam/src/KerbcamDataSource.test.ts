import { Layer } from "@jonpepler/kerbcam";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "./KerbcamDataSource";
import { createMockKerbcamSession } from "./test/MockKerbcamSession";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
      status: 200,
    }),
  );
});

describe("KerbcamDataSource", () => {
  it("maps client state-change events onto DataSource status", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    expect(ds.status).toBe("disconnected");

    const seen: string[] = [];
    ds.onStatusChange((s) => seen.push(s));

    await ds.connect();
    session.setState("connected");

    expect(seen).toContain("reconnecting"); // "connecting" → "reconnecting"
    expect(seen).toContain("connected");
    expect(ds.status).toBe("connected");
  });

  it("routes set-fov execute() onto the control channel", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop the hello

    await ds.execute("kerbcam.set-fov[42,35.5]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-fov",
        content: { flightId: 42, fov: 35.5 },
      }),
    );
  });

  it("routes set-layers execute() with NEAR / SCALED layer args", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0;

    await ds.execute("kerbcam.set-layers[7,NEAR,SCALED]");

    expect(session.sentMessages[0]).toBe(
      JSON.stringify({
        type: "set-layers",
        content: { flightId: 7, layers: [Layer.Near, Layer.Scaled] },
      }),
    );
  });

  it("subscribe('kerbcam.cameras') replays the current snapshot", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    const received: unknown[] = [];
    ds.subscribe("kerbcam.cameras", (v) => received.push(v));

    await new Promise<void>((r) => queueMicrotask(r));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
  });
});

describe("KerbcamDataSource — keepalive + reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds to ping with pong", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.openChannel();
    session.sentMessages.length = 0; // drop hello

    session.sendServerMessage({ type: "ping" });

    expect(session.sentMessages).toContain(JSON.stringify({ type: "pong" }));
  });

  it("ping resets the watchdog so no reconnect fires within 15s of last ping", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Advance 14s — no ping yet, watchdog hasn't fired
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // Fire a ping (resets the watchdog)
    session.sendServerMessage({ type: "ping" });

    // Advance another 14s (28s total from connect, but only 14s since the ping)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // No reconnect attempt should have happened
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);

    ds.disconnect();
  });

  it("watchdog fires after 15s and triggers reconnect", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // No ping — advance past the 15s watchdog
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });

    // Reconnect attempt should have fired (a new /offer fetch)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    ds.disconnect();
  });

  it("explicit disconnect() prevents reconnect after watchdog fires", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    ds.disconnect();

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsAfterDisconnect = fetchSpy.mock.calls.length;

    // Advance well past any watchdog or reconnect threshold
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchSpy.mock.calls.length).toBe(callsAfterDisconnect);
  });

  it("WebRTC 'failed' triggers exponential backoff", async () => {
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

    await ds.connect();
    session.setState("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Fire a failed state — should schedule a reconnect at 2s
    session.setState("failed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    ds.disconnect();
  });
});
