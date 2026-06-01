import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerAnalyticsConfigRoutes } from "../analyticsConfig.js";

describe("analytics-config routes (fastify.inject)", () => {
  async function buildApp() {
    const app = Fastify();
    const changes: boolean[] = [];
    const controller = registerAnalyticsConfigRoutes(app, {
      onChange: (enabled) => changes.push(enabled),
    });
    await app.ready();
    return { app, controller, changes };
  }

  it("defaults to disabled until the first POST", async () => {
    const { app } = await buildApp();
    const get = await app.inject({ method: "GET", url: "/analytics-config" });
    expect(get.json()).toEqual({ enabled: false });
    await app.close();
  });

  it("POST sets the value and GET reflects it", async () => {
    const { app } = await buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: { enabled: true },
    });
    expect(post.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/analytics-config" });
    expect(get.json()).toEqual({ enabled: true });
    await app.close();
  });

  it("POST without a boolean enabled is rejected 400", async () => {
    const { app } = await buildApp();
    const bad = await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: { enabled: "yes" },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    await app.close();
  });

  it("fires onChange with the initial state and on every change", async () => {
    const { app, changes } = await buildApp();
    // Initial apply on registration (default disabled).
    expect(changes).toEqual([false]);
    await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: { enabled: true },
    });
    // A repeat POST of the same value should NOT re-fire (dedupe).
    await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: { enabled: true },
    });
    await app.inject({
      method: "POST",
      url: "/analytics-config",
      payload: { enabled: false },
    });
    expect(changes).toEqual([false, true, false]);
    await app.close();
  });
});

describe("analytics-config SSE stream (real listen)", () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  /**
   * Read SSE `data:` frames from a live response until `count` have arrived,
   * then abort. Returns the parsed `enabled` booleans in order.
   */
  async function readFrames(
    url: string,
    count: number,
    signal: AbortSignal,
  ): Promise<boolean[]> {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.body) throw new Error("no SSE body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const out: boolean[] = [];
    let buffer = "";
    while (out.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          const parsed = JSON.parse(line.slice(5).trim());
          out.push(parsed.enabled);
        }
        sep = buffer.indexOf("\n\n");
      }
    }
    return out;
  }

  it("pushes the current value on subscribe and on every change", async () => {
    app = Fastify();
    const controller = registerAnalyticsConfigRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const ac = new AbortController();
    const framesPromise = readFrames(
      `${base}/analytics-config/stream`,
      2,
      ac.signal,
    );

    // Let the subscribe land (first frame = current value), then flip.
    await new Promise((r) => setTimeout(r, 50));
    controller.set(true);

    const frames = await framesPromise;
    ac.abort();
    expect(frames).toEqual([false, true]);
  });

  it("removes the subscriber when the client disconnects", async () => {
    app = Fastify();
    const controller = registerAnalyticsConfigRoutes(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const ac = new AbortController();
    await readFrames(`${base}/analytics-config/stream`, 1, ac.signal);
    expect(controller.subscriberCount()).toBe(1);
    ac.abort();
    // Give the server's `close` handler a tick to run the unsub.
    await new Promise((r) => setTimeout(r, 100));
    expect(controller.subscriberCount()).toBe(0);
  });
});
