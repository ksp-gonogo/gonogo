import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsConfigClient } from "../analyticsConfigClient.js";

/**
 * Build a Response whose body streams the given SSE frames, with a manual
 * `push` to emit more and `endStream` to close it — lets a test drive the
 * relay's stream shape without a real server.
 */
function makeStreamResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const res = new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  return {
    res,
    pushEnabled(enabled: boolean) {
      controller?.enqueue(
        encoder.encode(`data: ${JSON.stringify({ enabled })}\n\n`),
      );
    },
    endStream() {
      controller?.close();
    },
  };
}

describe("AnalyticsConfigClient", () => {
  let client: AnalyticsConfigClient | null = null;

  afterEach(() => {
    client?.stop();
    client = null;
  });

  it("reports each consent value the stream emits", async () => {
    const stream = makeStreamResponse();
    const fetchImpl = vi.fn(async () => stream.res) as unknown as typeof fetch;
    const received: boolean[] = [];

    client = new AnalyticsConfigClient({
      relayUrl: "http://relay.test",
      onConsent: (enabled) => received.push(enabled),
      fetchImpl,
    });
    client.start();

    // Let connect() reach the read loop.
    await new Promise((r) => setTimeout(r, 10));
    stream.pushEnabled(false);
    stream.pushEnabled(true);
    stream.pushEnabled(false);
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toEqual([false, true, false]);
  });

  it("targets the relay's /analytics-config/stream endpoint", async () => {
    const stream = makeStreamResponse();
    const fetchImpl = vi.fn(async () => stream.res) as unknown as typeof fetch;
    client = new AnalyticsConfigClient({
      relayUrl: "http://relay.test/",
      onConsent: () => {},
      fetchImpl,
    });
    client.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://relay.test/analytics-config/stream",
      expect.objectContaining({ headers: { accept: "text/event-stream" } }),
    );
  });

  it("reconnects after the stream drops", async () => {
    const first = makeStreamResponse();
    const second = makeStreamResponse();
    const responses = [first.res, second.res];
    const fetchImpl = vi.fn(
      async () => responses.shift() ?? new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;
    const received: boolean[] = [];

    client = new AnalyticsConfigClient({
      relayUrl: "http://relay.test",
      onConsent: (enabled) => received.push(enabled),
      fetchImpl,
      reconnectMs: 10,
    });
    client.start();

    await new Promise((r) => setTimeout(r, 10));
    first.pushEnabled(true);
    await new Promise((r) => setTimeout(r, 10));
    first.endStream(); // drop → schedules reconnect

    await new Promise((r) => setTimeout(r, 40));
    second.pushEnabled(false);
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(received).toEqual([true, false]);
  });

  it("retries on a non-ok response without throwing", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;
    client = new AnalyticsConfigClient({
      relayUrl: "http://relay.test",
      onConsent: () => {},
      fetchImpl,
      reconnectMs: 10,
    });
    client.start();
    await new Promise((r) => setTimeout(r, 40));
    // Multiple attempts scheduled; no crash.
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("stop() halts reconnection", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;
    client = new AnalyticsConfigClient({
      relayUrl: "http://relay.test",
      onConsent: () => {},
      fetchImpl,
      reconnectMs: 10,
    });
    client.start();
    await new Promise((r) => setTimeout(r, 15));
    client.stop();
    const callsAfterStop = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchImpl.mock.calls.length).toBe(callsAfterStop);
  });
});
