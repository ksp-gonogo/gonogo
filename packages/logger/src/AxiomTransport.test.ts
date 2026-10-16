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
    expect(client.ingest).toHaveBeenCalledTimes(1);
    expect(client.ingest).toHaveBeenCalledWith("gonogo", [entry("hello")]);
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

  it("swallows ingest errors so logging never crashes the caller", () => {
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

  it("flushes the client when the browser fires pagehide", async () => {
    const client = makeClient();
    const transport = new AxiomTransport({
      client,
      dataset: "gonogo",
      flushOnPageHide: true,
    });
    expect(listeners).toHaveLength(1);
    listeners[0]();
    await Promise.resolve();
    expect(client.flush).toHaveBeenCalledTimes(1);
    transport.dispose();
    expect(listeners).toHaveLength(0);
  });
});

describe("AxiomTransport scrubbing", () => {
  const SENSITIVE = {
    shareCode: "XK3F",
    address: "192.168.1.20",
    relatedAddress: "10.0.0.7",
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
      /XK3F|192\.168|10\.0\.0\.7|deck\.local|0b9d2c4e|example\.com|secret/,
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
      /XK3F|192\.168|10\.0\.0\.7|deck\.local|0b9d2c4e|example\.com|secret/,
    );
  });

  it("masks share codes, addresses, URLs and peer ids written into text", () => {
    const sent = sentFrom({
      ...entry(
        "[PeerHost] open: id=XK3F (shareCode=XK3F) from 192.168.1.20:8090 via ws://deck.local:8090/stream peer station-0b9d2c4e-1a2b-4c3d-8e9f-0123456789ab-t0k3n v6 fe80::1ff:fe23:4567:890a",
      ),
      error: {
        name: "Error",
        message: "GET https://example.com/a/b failed",
        stack: "at 10.0.0.7",
      },
    });
    expect(JSON.stringify(sent)).not.toMatch(
      /XK3F|192\.168|10\.0\.0\.7|deck\.local|0b9d2c4e|example\.com|fe80|\/stream|a\/b/,
    );
    expect(sent.message).toContain("[PeerHost] open:");
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
