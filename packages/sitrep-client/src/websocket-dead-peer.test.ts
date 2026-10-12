import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";
import { WebSocketTransport } from "./websocket-transport";

/**
 * A peer that stops answering without ever closing its socket, the way a
 * killed tunnel leaves the browser's end: no `close` event, no error. Every
 * option is left at its default, so what is measured is what an operator gets.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A silent peer is judged dead within the silence window plus the probe window, with a little slack for the machine. */
const DEAD_PEER_BUDGET_MS = 7_000;

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  describeFailure: () => string,
): Promise<number> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve(Date.now() - started);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(describeFailure()));
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("a peer that goes silent without closing its socket", () => {
  it("is judged dead within a few seconds on the default timings", async () => {
    server.use(link.addEventListener("connection", () => undefined));
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 60_000,
    });
    await waitFor(
      () => transport.status === "connected",
      DEAD_PEER_BUDGET_MS,
      () => `never connected (${transport.status})`,
    );
    transport.send({ type: "subscribe", topic: "vessel.control" });

    const elapsed = await waitFor(
      () => transport.status === "reconnecting",
      DEAD_PEER_BUDGET_MS,
      () => `still ${transport.status} after ${DEAD_PEER_BUDGET_MS} ms`,
    );
    expect(elapsed).toBeLessThan(DEAD_PEER_BUDGET_MS);
    transport.dispose();
  }, 15_000);

  it("turns every held reading's grade to disconnected once it is judged dead", async () => {
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type !== "subscribe") return;
          const frame: ServerMessage = {
            type: "stream-data",
            topic: message.topic,
            payload: { sas: true },
            meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
          };
          client.send(JSON.stringify(frame));
        });
      }),
    );
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 60_000,
    });
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );
    client.attachStore(store);
    client.subscribe("vessel.control", () => undefined);

    await waitFor(
      () => {
        store.beginFrame();
        return store.sampleStatus("vessel.control") !== "resyncing";
      },
      DEAD_PEER_BUDGET_MS,
      () => "the first frame never landed",
    );
    expect(store.sampleStatus("vessel.control")).not.toBe("disconnected");

    await waitFor(
      () => {
        store.beginFrame();
        return store.sampleStatus("vessel.control") === "disconnected";
      },
      DEAD_PEER_BUDGET_MS,
      () =>
        `still ${store.sampleStatus("vessel.control")} after ${DEAD_PEER_BUDGET_MS} ms`,
    );
    client.dispose();
    transport.dispose();
  }, 15_000);
});
