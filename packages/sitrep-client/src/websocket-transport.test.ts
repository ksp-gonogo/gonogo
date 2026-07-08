import type { ServerMessage } from "@gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { makeMeta } from "./stub-transport";
import type { TransportStatus } from "./transport";
import { WebSocketTransport } from "./websocket-transport";

/**
 * Network-boundary tests for `WebSocketTransport` (browser-transport brief §
 * Validation): intercept the real WebSocket via MSW's `ws` link — the same
 * pattern the app's Telemachus WS tests use — and drive connect -> subscribe
 * -> receive decoded envelope -> status transitions -> reconnect through the
 * REAL transport. No internal module is mocked.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function streamFrame(topic: string, payload: unknown): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
  };
  return JSON.stringify(message);
}

/** Resolves when `transport.status` reaches `target`. */
function waitForStatus(
  transport: WebSocketTransport,
  target: TransportStatus,
): Promise<void> {
  return new Promise((resolve) => {
    if (transport.status === target) return resolve();
    const off = transport.onStatusChange((status) => {
      if (status === target) {
        off();
        resolve();
      }
    });
  });
}

describe("WebSocketTransport", () => {
  it("connects and transitions reconnecting -> connected on open", async () => {
    server.use(link.addEventListener("connection", () => {}));
    const transport = new WebSocketTransport({ url: SITREP_URL });
    // Constructor kicks off the connect; status starts optimistic-pending.
    expect(transport.status).toBe("reconnecting");

    await waitForStatus(transport, "connected");
    expect(transport.status).toBe("connected");
    transport.dispose();
  });

  it("sends a subscribe message the server receives, then delivers the decoded envelope", async () => {
    const received: string[] = [];
    let serverClient: { send: (data: string) => void } | null = null;
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClient = client as unknown as { send: (data: string) => void };
        client.addEventListener("message", (event) => {
          received.push(event.data as string);
        });
      }),
    );

    const frames: ServerMessage[] = [];
    const streamFrames: string[] = [];
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      onStreamFrame: (info) => streamFrames.push(info.topic),
    });
    transport.onMessage((message) => frames.push(message));
    await waitForStatus(transport, "connected");

    transport.send({ type: "subscribe", topic: "vessel.orbit" });
    await vi.waitFor(() => {
      expect(received.map((raw) => JSON.parse(raw))).toContainEqual({
        type: "subscribe",
        topic: "vessel.orbit",
      });
    });

    serverClient?.send(streamFrame("vessel.orbit", { sma: 700000 }));
    await vi.waitFor(() => {
      expect(frames).toHaveLength(1);
    });

    const frame = frames[0];
    expect(frame.type).toBe("stream-data");
    expect(frame).toMatchObject({
      type: "stream-data",
      topic: "vessel.orbit",
      payload: { sma: 700000 },
    });
    // carriedChannels + perf-budget seam are both driven off arriving frames.
    expect(transport.carriedChannels).toContain("vessel.orbit");
    expect(streamFrames).toEqual(["vessel.orbit"]);
    transport.dispose();
  });

  it("reconnects after the server drops the connection and re-subscribes active topics", async () => {
    const receivedByConnection: string[][] = [];
    let closeFirst: (() => void) | null = null;
    server.use(
      link.addEventListener("connection", ({ client }) => {
        const bucket: string[] = [];
        receivedByConnection.push(bucket);
        client.addEventListener("message", (event) => {
          bucket.push(event.data as string);
        });
        if (receivedByConnection.length === 1) {
          closeFirst = () => client.close();
        }
      }),
    );

    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 10,
    });
    await waitForStatus(transport, "connected");
    transport.send({ type: "subscribe", topic: "vessel.flight" });
    await vi.waitFor(() => expect(receivedByConnection[0]).toHaveLength(1));

    // Server drops us -> reconnecting -> a fresh connection that re-subscribes.
    closeFirst?.();
    await waitForStatus(transport, "reconnecting");
    await waitForStatus(transport, "connected");

    await vi.waitFor(() => {
      expect(receivedByConnection).toHaveLength(2);
      expect(receivedByConnection[1].map((raw) => JSON.parse(raw))).toEqual([
        { type: "subscribe", topic: "vessel.flight" },
      ]);
    });
    transport.dispose();
  });

  it("gives up to disconnected once the retry timeout elapses", async () => {
    // Every connection is closed immediately; a monotonically advancing clock
    // pushes past the retry-timeout budget so the give-up branch fires.
    server.use(
      link.addEventListener("connection", ({ client }) => {
        setTimeout(() => client.close(), 0);
      }),
    );
    let clock = 0;
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 5,
      retryTimeoutMs: 20,
      now: () => {
        clock += 15;
        return clock;
      },
    });

    await waitForStatus(transport, "disconnected");
    expect(transport.status).toBe("disconnected");
    transport.dispose();
  });

  it("dispose() stops the transport and settles to disconnected", async () => {
    server.use(link.addEventListener("connection", () => {}));
    const transport = new WebSocketTransport({ url: SITREP_URL });
    await waitForStatus(transport, "connected");
    transport.dispose();
    expect(transport.status).toBe("disconnected");
  });
});
