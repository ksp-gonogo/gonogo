import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";
import { WebSocketTransport } from "./websocket-transport";

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function until(predicate: () => boolean, ms = 8_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > ms) return reject(new Error("timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("readings after the socket to the mod drops and comes back", () => {
  it("keeps a change-gated Topic readable when the new session sends it only once, on subscribe", async () => {
    let connections = 0;
    const silentAfterFirst = false;
    const closers: Array<() => void> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        connections += 1;
        closers.push(() => client.close());
        client.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type !== "subscribe") return;
          if (connections > 1 && silentAfterFirst) return;
          const frame: ServerMessage = {
            type: "stream-data",
            topic: message.topic,
            payload: { parts: [{ id: "p1" }] },
            meta: makeMeta({ validAt: connections, deliveredAt: connections }),
          };
          client.send(JSON.stringify(frame));
        });
      }),
    );
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 50,
      maxRetryIntervalMs: 50,
    });
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    client.attachStore(store);
    client.subscribe("vessel.parts", () => undefined);
    const status = () => {
      store.beginFrame();
      return store.sampleStatus("vessel.parts");
    };

    await until(() => status() === "live");
    closers[0]();
    await until(() => connections === 2);
    await until(() => transport.status === "connected");

    await until(() => status() !== "resyncing" && status() !== "disconnected");
    expect(["live", "held"]).toContain(status());
    expect(store.sample("vessel.parts")?.payload).toEqual({
      parts: [{ id: "p1" }],
    });
    client.dispose();
    transport.dispose();
  }, 20_000);

  it("keeps the last reading of a steady Topic the new session never sends again", async () => {
    let connections = 0;
    let closeFirst: (() => void) | undefined;
    server.use(
      link.addEventListener("connection", ({ client }) => {
        connections += 1;
        if (connections === 1) closeFirst = () => client.close();
        client.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type !== "subscribe" || connections > 1) return;
          const frame: ServerMessage = {
            type: "stream-data",
            topic: message.topic,
            payload: { parts: [{ id: "p1" }] },
            meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
          };
          client.send(JSON.stringify(frame));
        });
      }),
    );
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 50,
      maxRetryIntervalMs: 50,
    });
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    client.attachStore(store);
    client.subscribe("vessel.parts", () => undefined);
    const status = () => {
      store.beginFrame();
      return store.sampleStatus("vessel.parts");
    };

    await until(() => status() === "live");
    closeFirst?.();
    await until(() => connections === 2);
    await until(() => transport.status === "connected");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(status()).not.toBe("resyncing");
    expect(store.sample("vessel.parts")?.payload).toEqual({
      parts: [{ id: "p1" }],
    });
    client.dispose();
    transport.dispose();
  }, 20_000);
});
