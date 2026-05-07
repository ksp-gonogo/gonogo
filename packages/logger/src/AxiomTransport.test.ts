import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AxiomIngestClient, AxiomTransport } from "./AxiomTransport.js";
import type { LogEntry } from "./types.js";

function makeClient(): AxiomIngestClient & {
  ingest: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
} {
  return {
    ingest: vi.fn(),
    flush: vi.fn(async () => {}),
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
