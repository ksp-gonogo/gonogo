import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { type AxiomIngestClient, AxiomTransport } from "./AxiomTransport.js";
import type { LogEntry } from "./types.js";

/**
 * A client whose two methods are spies, each still carrying the signature the
 * transport calls it with, so a call site that drifts from the interface is a
 * type error here rather than a silently accepted `any`.
 */
function makeClient(): AxiomIngestClient & {
  ingest: Mock<AxiomIngestClient["ingest"]>;
  flush: Mock<AxiomIngestClient["flush"]>;
} {
  return {
    ingest: vi.fn<AxiomIngestClient["ingest"]>(),
    flush: vi.fn<AxiomIngestClient["flush"]>(async () => {}),
  };
}

function entry(message: string): LogEntry {
  return {
    level: "info",
    message,
    timestamp: "2026-05-07T00:00:00.000Z",
  };
}

describe("AxiomTransport", () => {
  let transport: AxiomTransport;

  afterEach(() => {
    transport?.dispose();
  });

  it("forwards entries to the injected client under the configured dataset", () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    transport.send([entry("hello")]);
    void transport.flush();
    expect(client.ingest).toHaveBeenCalledTimes(1);
    expect(client.ingest).toHaveBeenCalledWith("gonogo", [
      { _time: "2026-05-07T00:00:00.000Z", ...entry("hello") },
    ]);
  });

  it("files each event at the time it was logged, not when it arrives", () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    transport.send([
      {
        level: "info",
        message: "early",
        timestamp: "2026-10-18T09:00:01.000Z",
      },
    ]);
    void transport.flush();
    expect(client.ingest.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ _time: "2026-10-18T09:00:01.000Z" }),
    ]);
  });

  it("is a no-op for an empty batch", () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    transport.send([]);
    expect(client.ingest).not.toHaveBeenCalled();
  });

  it("swallows ingest errors so logging never crashes the caller", async () => {
    const client = makeClient();
    client.ingest.mockImplementation(() => {
      throw new Error("network down");
    });
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    expect(() => transport.send([entry("boom")])).not.toThrow();
    await expect(transport.flush()).resolves.toBeUndefined();
  });

  it("sends lines logged close together as one request", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      transport = new AxiomTransport({
        client,
        dataset: "gonogo",
        flushOnPageHide: false,
        flushIntervalMs: 500,
      });
      for (let i = 0; i < 20; i++) transport.send([entry(`line ${i}`)]);
      expect(client.ingest).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(client.ingest).toHaveBeenCalledTimes(1);
      expect(client.ingest.mock.calls[0]?.[1]).toHaveLength(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends at once when the queue reaches the size cap", () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    transport.send(Array.from({ length: 1200 }, (_, i) => entry(`l${i}`)));
    expect(
      client.ingest.mock.calls.map((c) => (c[1] as unknown[]).length),
    ).toEqual([500, 500, 200]);
  });

  it("flush() drains the underlying client", async () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    await transport.flush();
    expect(client.flush).toHaveBeenCalledTimes(1);
  });

  it("flush() swallows client failures", async () => {
    const client = makeClient();
    client.flush.mockRejectedValueOnce(new Error("nope"));
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    await expect(transport.flush()).resolves.toBeUndefined();
  });

  it("requires a dataset", () => {
    const client = makeClient();
    expect(
      () =>
        new AxiomTransport({
          client,
          dataset: "",
          flushOnPageHide: false,
        }),
    ).toThrow(/dataset/);
  });

  it("requires either a client or a token", () => {
    expect(
      () =>
        new AxiomTransport({
          dataset: "gonogo",
          flushOnPageHide: false,
        }),
    ).toThrow(/client.*token/);
  });
});

describe("AxiomTransport pagehide flushing", () => {
  let listeners: Array<() => void>;
  let originalAdd: typeof globalThis.addEventListener;
  let originalRemove: typeof globalThis.removeEventListener;

  beforeEach(() => {
    listeners = [];
    originalAdd = globalThis.addEventListener;
    originalRemove = globalThis.removeEventListener;
    globalThis.addEventListener = ((event: string, handler: () => void) => {
      if (event === "pagehide") listeners.push(handler);
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((event: string, handler: () => void) => {
      if (event === "pagehide") {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    }) as typeof globalThis.removeEventListener;
  });

  afterEach(() => {
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
  });

  it("sends what is queued and flushes the client when the browser fires pagehide", async () => {
    const client = makeClient();
    const transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: true,
    });
    expect(listeners).toHaveLength(1);
    transport.send([entry("last words")]);
    listeners[0]();
    await Promise.resolve();
    expect(client.ingest).toHaveBeenCalledTimes(1);
    expect(client.flush).toHaveBeenCalledTimes(1);
    transport.dispose();
    expect(listeners).toHaveLength(0);
  });
});

describe("AxiomTransport scrubbing", () => {
  const SENSITIVE = {
    shareCode: "XK3F",
    address: "203.0.113.20",
    relatedAddress: "198.51.100.7",
    kspHost: "deck.local",
    peerId: "station-0b9d2c4e-1a2b-4c3d-8e9f-0123456789ab-t0k3n",
    stationPeerId: "station-0b9d2c4e-1a2b-4c3d-8e9f-0123456789ab-t0k3n",
    url: "https://example.com/secret/path?code=XK3F",
  };

  function sentFrom(input: LogEntry): LogEntry {
    const client = makeClient();
    const transport = new AxiomTransport({
      dataset: "gonogo",
      client,
      flushOnPageHide: false,
    });
    transport.send([input]);
    void transport.flush();
    const events = client.ingest.mock.calls[0]?.[1] as readonly LogEntry[];
    return events[0] as LogEntry;
  }

  it("masks every identifying context field, by name", () => {
    const sent = sentFrom({
      ...entry("hello"),
      context: { ...SENSITIVE, kept: 7 },
    });
    const context = sent.context as Record<string, unknown>;
    for (const key of Object.keys(SENSITIVE)) {
      expect(context[key]).toMatch(/^<[a-z]+:[0-9a-f]{8}>$/);
    }
    expect(context.kept).toBe(7);
    expect(JSON.stringify(sent)).not.toMatch(
      /XK3F|203\.0\.113|198\.51\.100\.7|deck\.local|0b9d2c4e|example\.com|secret/,
    );
  });

  it("masks the same fields inside a bug report's recent logs", () => {
    const sent = sentFrom({
      ...entry("[bug-report] froze"),
      context: {
        bug_report: {
          recentLogs: [
            {
              ...entry("inner"),
              context: { ...SENSITIVE },
              device: { role: "host", id: "XK3F", peerId: "XK3F" },
            },
          ],
        },
      },
    });
    expect(JSON.stringify(sent)).not.toMatch(
      /XK3F|203\.0\.113|198\.51\.100\.7|deck\.local|0b9d2c4e|example\.com|secret/,
    );
  });

  it("masks share codes, addresses, URLs and peer ids written into text", () => {
    const sent = sentFrom({
      ...entry(
        "[PeerHost] open: id=XK3F (shareCode=XK3F) from 203.0.113.20:8090 via ws://deck.local:8090/stream peer station-0b9d2c4e-1a2b-4c3d-8e9f-0123456789ab-t0k3n v6 fe80::1ff:fe23:4567:890a",
      ),
      error: {
        name: "Error",
        message: "GET https://example.com/a/b failed",
        stack: "at 198.51.100.7",
      },
    });
    expect(JSON.stringify(sent)).not.toMatch(
      /XK3F|203\.0\.113|198\.51\.100\.7|deck\.local|0b9d2c4e|example\.com|fe80|\/stream|a\/b/,
    );
    expect(sent.message).toContain("[PeerHost] open:");
  });

  it("masks a station's device.peerId as the same tag its text mentions carry", () => {
    const a = sentFrom({
      ...entry(`[PeerHost] incoming connection from ${SENSITIVE.peerId}`),
      device: { role: "station", peerId: SENSITIVE.peerId },
    });
    const fromText = /<peer:[0-9a-f]{8}>/.exec(a.message)?.[0];
    expect(a.device?.peerId).toBe(fromText);
  });

  it("keeps the same peer correlatable across entries and leaves clock times alone", () => {
    const a = sentFrom({
      ...entry("x"),
      device: { role: "station", peerId: SENSITIVE.peerId },
    });
    const b = sentFrom({
      ...entry("y"),
      device: { role: "station", peerId: SENSITIVE.peerId },
    });
    expect(a.device?.peerId).toBe(b.device?.peerId);
    expect(sentFrom(entry("at 12:30:45 UTC")).message).toBe("at 12:30:45 UTC");
  });
});

describe("AxiomTransport delivery", () => {
  let transport: AxiomTransport;
  let handlers: Record<string, Array<() => void>>;
  let originalAdd: typeof globalThis.addEventListener;
  let originalRemove: typeof globalThis.removeEventListener;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {};
    originalAdd = globalThis.addEventListener;
    originalRemove = globalThis.removeEventListener;
    globalThis.addEventListener = ((type: string, handler: () => void) => {
      handlers[type] = [...(handlers[type] ?? []), handler];
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((type: string, handler: () => void) => {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== handler);
    }) as typeof globalThis.removeEventListener;
  });

  afterEach(() => {
    transport?.dispose();
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
    vi.useRealTimers();
  });

  it("tries again after a failed flush, with the connection still down", async () => {
    const client = makeClient();
    client.flush
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });

    transport.send([entry("while offline")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.flush).toHaveBeenCalledTimes(3);
  });

  it("stops retrying once a flush goes through", async () => {
    const client = makeClient();
    client.flush.mockRejectedValueOnce(new Error("offline"));
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });

    transport.send([entry("a")]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    const calls = client.flush.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(client.flush).toHaveBeenCalledTimes(calls);
  });

  it("sends an error entry at once instead of waiting out the hold", async () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });

    transport.send([{ ...entry("crashed"), level: "error" }]);
    await Promise.resolve();

    expect(client.ingest).toHaveBeenCalledTimes(1);
    expect(client.flush).toHaveBeenCalledTimes(1);
  });

  it("asks for the request to outlive the page when the page is hiding", async () => {
    const client = makeClient();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: true,
    });

    transport.send([entry("last words")]);
    handlers.pagehide[0]();
    await Promise.resolve();

    expect(client.flush).toHaveBeenCalledWith({ keepalive: true });
  });

  it("makes a flush wait for one already under way, so its caller learns whether delivery failed", async () => {
    const client = makeClient();
    client.flush
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("offline")), 500),
          ),
      )
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
      onError,
    });

    transport.send([{ ...entry("report"), level: "error" }]);
    let settled = false;
    const explicit = transport.flush().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await explicit;

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("flushes again when the browser reports it is back online", async () => {
    const client = makeClient();
    client.flush.mockRejectedValueOnce(new Error("offline"));
    transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });

    transport.send([entry("a")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.flush).toHaveBeenCalledTimes(1);
    handlers.online[0]();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.flush).toHaveBeenCalledTimes(2);
  });
});

describe("AxiomTransport field cap", () => {
  it("sends an object keyed by data as one JSON string and keeps a fixed-shape one", () => {
    const client = makeClient();
    const transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: false,
    });
    const byChannel = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`topic-${i}`, { fps: i }]),
    );
    transport.send([
      {
        ...entry("x"),
        context: {
          channels: byChannel,
          rows: [{ channel: "a", fps: 1 }],
          initial: { a: 1, b: { c: { d: { e: 1 } } } },
        },
      },
    ]);
    void transport.flush();
    transport.dispose();
    const [, events] = client.ingest.mock.calls[0] as [
      string,
      { context: Record<string, unknown> }[],
    ];
    const ctx = events[0].context;
    expect(ctx.channels).toBe(JSON.stringify(byChannel));
    expect(ctx.rows).toEqual([{ channel: "a", fps: 1 }]);
    expect(ctx.initial).toEqual({
      a: 1,
      b: { c: { d: JSON.stringify({ e: 1 }) } },
    });
  });
});
