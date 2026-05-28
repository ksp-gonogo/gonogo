import type {
  KerbcamDataChannel,
  KerbcamPeer,
  KerbcamTransport,
} from "@jonpepler/kerbcam";
import { Layer } from "@jonpepler/kerbcam";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "./KerbcamDataSource";

// Minimal in-memory transport that captures the control channel +
// peer state-change handler so the test can fire them synchronously.
function makeFakeTransport() {
  const captured: {
    dc?: KerbcamDataChannel & { sent: string[]; _open: () => void };
    onState?: (
      s: "disconnected" | "connecting" | "connected" | "failed",
    ) => void;
    onMessage?: (raw: string) => void;
    closed: boolean;
  } = { closed: false };

  const transport: KerbcamTransport = {
    createPeer: () => {
      const ch = {
        sent: [] as string[],
        send: (s: string) => ch.sent.push(s),
        onOpen: (h: () => void) => {
          ch._open = h;
        },
        onMessage: (h: (raw: string) => void) => {
          captured.onMessage = h;
        },
        onClose: () => {},
        _open: () => {},
      };
      const peer: KerbcamPeer = {
        addRecvOnlyTransceiver: () => {},
        createDataChannel: () => {
          captured.dc = ch as typeof captured.dc & typeof ch;
          return ch;
        },
        onTrack: () => {},
        onStateChange: (h) => {
          captured.onState = h;
        },
        createOffer: async () => "v=0\r\n",
        setLocalDescription: async () => {},
        setRemoteAnswer: async () => {},
        waitForIceComplete: async () => {},
        localSdp: () => "v=0\r\n",
        close: () => {
          captured.closed = true;
        },
      };
      return peer;
    },
  };

  return { transport, captured };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
      status: 200,
    }),
  );
});

describe("KerbcamDataSource", () => {
  it("maps client state-change events onto DataSource status", async () => {
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);
    expect(ds.status).toBe("disconnected");

    const seen: string[] = [];
    ds.onStatusChange((s) => seen.push(s));

    await ds.connect();
    captured.onState?.("connected");

    expect(seen).toContain("reconnecting"); // "connecting" → "reconnecting"
    expect(seen).toContain("connected");
    expect(ds.status).toBe("connected");
  });

  it("routes set-fov execute() onto the control channel", async () => {
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);
    await ds.connect();
    captured.dc?._open();
    if (captured.dc) captured.dc.sent.length = 0; // drop the hello

    await ds.execute("kerbcam.set-fov[42,35.5]");

    expect(captured.dc?.sent[0]).toBe(
      JSON.stringify({
        type: "set-fov",
        content: { flightId: 42, fov: 35.5 },
      }),
    );
  });

  it("routes set-layers execute() with NEAR / SCALED layer args", async () => {
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);
    await ds.connect();
    captured.dc?._open();
    if (captured.dc) captured.dc.sent.length = 0;

    await ds.execute("kerbcam.set-layers[7,NEAR,SCALED]");

    expect(captured.dc?.sent[0]).toBe(
      JSON.stringify({
        type: "set-layers",
        content: { flightId: 7, layers: [Layer.Near, Layer.Scaled] },
      }),
    );
  });

  it("subscribe('kerbcam.cameras') replays the current snapshot", async () => {
    const { transport } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

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
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

    await ds.connect();
    captured.dc?._open();
    if (captured.dc) captured.dc.sent.length = 0; // drop hello

    captured.onMessage?.(JSON.stringify({ type: "ping" }));

    expect(captured.dc?.sent).toContain(JSON.stringify({ type: "pong" }));
  });

  it("ping resets the watchdog so no reconnect fires within 15s of last ping", async () => {
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

    await ds.connect();
    captured.onState?.("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Advance 14s — no ping yet, watchdog hasn't fired
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // Fire a ping (resets the watchdog)
    captured.onMessage?.(JSON.stringify({ type: "ping" }));

    // Advance another 14s (28s total from connect, but only 14s since the ping)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });

    // No reconnect attempt should have happened
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);

    ds.disconnect();
  });

  it("watchdog fires after 15s and triggers reconnect", async () => {
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

    await ds.connect();
    captured.onState?.("connected");

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
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

    await ds.connect();
    captured.onState?.("connected");

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
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

    await ds.connect();
    captured.onState?.("connected");

    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBefore = fetchSpy.mock.calls.length;

    // Fire a failed state — should schedule a reconnect at 2s
    captured.onState?.("failed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_001);
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    ds.disconnect();
  });
});
