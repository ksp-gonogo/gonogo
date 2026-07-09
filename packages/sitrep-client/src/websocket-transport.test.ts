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

/**
 * Wait budget for the real-timer / real-network waits in this file (MSW WS
 * handshake, reconnect backoff). These are the only genuinely time-dependent
 * waits in the package; every other suite drives an injected clock/scheduler
 * and is deterministic. The default `vi.waitFor` window is 1000ms, which is
 * ample on an idle machine but too tight when the full 15-package `turbo test`
 * saturates every core — a real WS handshake or reconnect can then legitimately
 * take longer than a second. Sizing the window to the operation (not the idle
 * case) is what stops this file from flaking under contention, without touching
 * any assertion. See the "act-warnings load-dependent" note in CLAUDE.md.
 */
const WAIT_TIMEOUT_MS = 4000;

/**
 * Resolves when `transport.status` reaches `target`. Rejects with a clear
 * message if it hasn't within `WAIT_TIMEOUT_MS`, so a genuine hang fails
 * legibly instead of silently consuming the whole 5000ms `testTimeout` and
 * surfacing as an opaque "Test timed out".
 */
function waitForStatus(
  transport: WebSocketTransport,
  target: TransportStatus,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (transport.status === target) return resolve();
    const timer = setTimeout(() => {
      off();
      reject(
        new Error(
          `waitForStatus: status never reached "${target}" within ${WAIT_TIMEOUT_MS}ms (last: "${transport.status}")`,
        ),
      );
    }, WAIT_TIMEOUT_MS);
    const off = transport.onStatusChange((status) => {
      if (status === target) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

/**
 * A hand-driven fake `WebSocket` for the event-timing edge cases MSW can't
 * easily produce (an `error` with no `close`, a socket that fires `close`
 * twice). Records every constructed instance so a test can assert how many
 * sockets the retry loop opened.
 */
function makeFakeSocketCtor() {
  const instances: Array<{
    fire: (type: "open" | "close" | "error") => void;
    readyState: number;
  }> = [];

  class FakeSocket {
    static readonly OPEN = 1;
    readyState = 0;
    private readonly listeners = new Map<string, Array<() => void>>();
    constructor(_url: string) {
      instances.push(this);
    }
    send(): void {}
    close(): void {
      this.readyState = 3;
    }
    addEventListener(type: string, listener: () => void): void {
      const bucket = this.listeners.get(type) ?? [];
      bucket.push(listener);
      this.listeners.set(type, bucket);
    }
    fire(type: "open" | "close" | "error"): void {
      for (const l of this.listeners.get(type) ?? []) l();
    }
  }

  return {
    ctor: FakeSocket as unknown as ConstructorParameters<
      typeof WebSocketTransport
    >[0] extends { WebSocketImpl?: infer C }
      ? NonNullable<C>
      : never,
    instances,
  };
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
    await vi.waitFor(
      () => {
        expect(received.map((raw) => JSON.parse(raw))).toContainEqual({
          type: "subscribe",
          topic: "vessel.orbit",
        });
      },
      { timeout: WAIT_TIMEOUT_MS },
    );

    serverClient?.send(streamFrame("vessel.orbit", { sma: 700000 }));
    await vi.waitFor(
      () => {
        expect(frames).toHaveLength(1);
      },
      { timeout: WAIT_TIMEOUT_MS },
    );

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
    await vi.waitFor(() => expect(receivedByConnection[0]).toHaveLength(1), {
      timeout: WAIT_TIMEOUT_MS,
    });

    // Server drops us -> reconnecting -> a fresh connection that re-subscribes.
    closeFirst?.();
    await waitForStatus(transport, "reconnecting");
    await waitForStatus(transport, "connected");

    await vi.waitFor(
      () => {
        expect(receivedByConnection).toHaveLength(2);
        expect(receivedByConnection[1].map((raw) => JSON.parse(raw))).toEqual([
          { type: "subscribe", topic: "vessel.flight" },
        ]);
      },
      { timeout: WAIT_TIMEOUT_MS },
    );
    transport.dispose();
  });

  it("gives up to disconnected once the retry timeout elapses without ever connecting", async () => {
    // Give-up applies to an outage that never recovers: every socket fails to
    // connect (fires `close` with no `open`, so the per-outage window is never
    // reset), and a monotonically advancing clock pushes past the retry-timeout
    // budget so the give-up branch fires.
    const fakes = makeFakeSocketCtor();
    let clock = 0;
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 1,
      retryTimeoutMs: 20,
      WebSocketImpl: fakes.ctor,
      now: () => {
        clock += 15;
        return clock;
      },
    });

    // Fail the very first connect; the retry loop then opens fresh sockets that
    // the loop below keeps failing until the budget is exhausted.
    const failNext = () => {
      const latest = fakes.instances.at(-1);
      latest?.fire("close");
    };
    failNext();
    await vi.waitFor(
      () => {
        failNext();
        expect(transport.status).toBe("disconnected");
      },
      { timeout: WAIT_TIMEOUT_MS },
    );
    expect(transport.status).toBe("disconnected");
    transport.dispose();
  });

  it("resets the give-up window per outage: a drop long after a successful reconnect still retries", async () => {
    // Regression for the session-wide give-up clock. Track each connection so
    // the test can close them on demand, and re-arm a close handle for every
    // new connection.
    const closers: Array<() => void> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        closers.push(() => client.close());
      }),
    );

    // A clock the test advances by hand. retryStart is only sampled inside the
    // drop path, so driving `now` here fully controls the give-up arithmetic.
    let clock = 0;
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 5,
      retryTimeoutMs: 1_000,
      now: () => clock,
    });

    // First connection comes up.
    await waitForStatus(transport, "connected");
    expect(closers).toHaveLength(1);

    // First outage — well inside the window — reconnects.
    closers[0]();
    await waitForStatus(transport, "reconnecting");
    await waitForStatus(transport, "connected");
    await vi.waitFor(() => expect(closers).toHaveLength(2), {
      timeout: WAIT_TIMEOUT_MS,
    });

    // Hours pass while happily connected: wall clock jumps far past
    // retryTimeoutMs measured from the FIRST-ever drop.
    clock = 10_000;

    // Second outage. With a session-wide clock this would give up with zero
    // retries; with a per-outage window it must reconnect again.
    closers[1]();
    await waitForStatus(transport, "reconnecting");
    await waitForStatus(transport, "connected");
    expect(transport.status).toBe("connected");
    transport.dispose();
  });

  it("recovers from an `error` that never fires `close` (Fix #2)", async () => {
    // A fake socket the test drives by hand — lets us fire `error` with no
    // following `close`, which the real browser can do and which used to
    // strand the transport in `error` forever.
    const fakes = makeFakeSocketCtor();
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 1,
      retryTimeoutMs: 10_000,
      WebSocketImpl: fakes.ctor,
    });
    expect(fakes.instances).toHaveLength(1);

    // Error only — no close event follows.
    fakes.instances[0].fire("error");
    expect(transport.status).toBe("reconnecting");

    // The retry loop opens a fresh socket despite never seeing a `close`.
    await vi.waitFor(() => expect(fakes.instances).toHaveLength(2), {
      timeout: WAIT_TIMEOUT_MS,
    });
    transport.dispose();
  });

  it("ignores a second `close` on the same socket (Fix #3)", async () => {
    const fakes = makeFakeSocketCtor();
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 1,
      retryTimeoutMs: 10_000,
      WebSocketImpl: fakes.ctor,
    });
    const first = fakes.instances[0];

    // Two close events on the same socket must trigger only ONE retry — the
    // second is a no-op, so no leaked timer and no double-open.
    first.fire("close");
    first.fire("close");

    await vi.waitFor(() => expect(fakes.instances).toHaveLength(2), {
      timeout: WAIT_TIMEOUT_MS,
    });
    // Give any erroneously-scheduled second timer a chance to fire; only the
    // one legitimate reconnect should have opened a socket.
    await new Promise((r) => setTimeout(r, 20));
    expect(fakes.instances).toHaveLength(2);
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
