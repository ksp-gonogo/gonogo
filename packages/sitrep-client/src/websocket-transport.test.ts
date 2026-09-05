import type { ClientMessage, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import {
  COMMAND_UNDELIVERED,
  classifyCommandRejection,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { ManualClock } from "@ksp-gonogo/sitrep-server";
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
import { LOSS_MARGIN, TelemetryClient } from "./client";
import { makeMeta } from "./stub-transport";
import type { TransportStatus } from "./transport";
import {
  MAX_PENDING_COMMANDS,
  SEND_QUEUE_FULL,
  WebSocketTransport,
} from "./websocket-transport";

/**
 * Network-boundary tests for `WebSocketTransport` (browser-transport brief §
 * Validation): intercept the real WebSocket via MSW's `ws` link, the same
 * pattern the app's other WS tests use, and drive connect -> subscribe
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
 * saturates every core: a real WS handshake or reconnect can then legitimately
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
    sent: string[];
  }> = [];

  class FakeSocket {
    static readonly OPEN = 1;
    readyState = 0;
    /** Every wire payload the transport handed this socket, in order. */
    readonly sent: string[] = [];
    private readonly listeners = new Map<string, Array<() => void>>();
    constructor(_url: string) {
      instances.push(this);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = 3;
    }
    addEventListener(type: string, listener: () => void): void {
      const bucket = this.listeners.get(type) ?? [];
      bucket.push(listener);
      this.listeners.set(type, bucket);
    }
    fire(type: "open" | "close" | "error"): void {
      // Move `readyState` with the event, so a test that opens this socket
      // reaches the same `readyState === OPEN` gate `sendRaw` checks.
      if (type === "open") this.readyState = 1;
      if (type !== "open") this.readyState = 3;
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
    /**
     * A box rather than a `let`, because a variable only ever assigned inside a
     * callback still reads as its initialiser at the use site: `serverClient`
     * narrowed to `null` and `.send` came off `never`.
     */
    const serverClient: { current: { send: (data: string) => void } | null } = {
      current: null,
    };
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClient.current = client as unknown as {
          send: (data: string) => void;
        };
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

    serverClient.current?.send(streamFrame("vessel.orbit", { sma: 700000 }));
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
      // Wrapped: the wire carries a bare number and `parseServerMessage` gives
      // it its declared unit back, which is what a consumer receives.
      payload: { sma: value("m", 700000) },
    });
    // carriedChannels + perf-budget seam are both driven off arriving frames.
    expect(transport.carriedChannels).toContain("vessel.orbit");
    expect(streamFrames).toEqual(["vessel.orbit"]);
    transport.dispose();
  });

  it("decodes BINARY stream frames (the real mod server frames JSON as binary, not text)", async () => {
    // Regression for the live-render bug: the mod server (Fleck) sends stream
    // frames as BINARY WebSocket frames. The transport previously dropped every
    // non-string payload, so nothing rendered in a real browser, invisible to
    // the text-only MSW/stub harnesses. This test sends the frame as bytes.

    /** Boxed for the same reason as the subscribe test above. */
    const serverClient: {
      current: {
        send: (data: string | ArrayBuffer | ArrayBufferView) => void;
      } | null;
    } = { current: null };
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClient.current = client as unknown as typeof serverClient.current;
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

    // Encode the exact same envelope as bytes and send it as a binary frame.
    const bytes = new TextEncoder().encode(
      streamFrame("vessel.flight", { altitudeAsl: 249999 }),
    );
    serverClient.current?.send(bytes);

    await vi.waitFor(() => expect(frames).toHaveLength(1), {
      timeout: WAIT_TIMEOUT_MS,
    });
    expect(frames[0]).toMatchObject({
      type: "stream-data",
      topic: "vessel.flight",
      payload: { altitudeAsl: value("m", 249999) },
    });
    expect(transport.carriedChannels).toContain("vessel.flight");
    expect(streamFrames).toEqual(["vessel.flight"]);
    transport.dispose();
  });

  it("reconnects after the server drops the connection and re-subscribes active topics", async () => {
    const receivedByConnection: string[][] = [];
    const closeFirst: { current: (() => void) | null } = { current: null };
    server.use(
      link.addEventListener("connection", ({ client }) => {
        const bucket: string[] = [];
        receivedByConnection.push(bucket);
        client.addEventListener("message", (event) => {
          bucket.push(event.data as string);
        });
        if (receivedByConnection.length === 1) {
          closeFirst.current = () => client.close();
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
    closeFirst.current?.();
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

    // First outage, well inside the window: reconnects.
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
    // A fake socket the test drives by hand, lets us fire `error` with no
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

    // Error only: no close event follows.
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

    // Two close events on the same socket must trigger only ONE retry, the
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

/**
 * The outbound queue: what the transport holds for a link that is down, and
 * what it does when it cannot hold any more.
 *
 * A tab left open through a long outage kept queueing command-requests with no
 * cap at all, so the backlog grew until the page stopped working. Bounding it
 * means SOMETHING has to be dropped, and the rule these tests pin is that no
 * command is ever dropped silently: every one is either delivered on the next
 * open or refused to its sender.
 */
describe("WebSocketTransport outbound queue", () => {
  /** A command-request envelope, distinguishable by `requestId`. */
  function commandRequest(requestId: string): ClientMessage {
    return {
      type: "command-request",
      requestId,
      command: "vessel.stage",
      label: "",
      topic: "",
      vantage: "",
      args: undefined,
      sentAt: 0,
    };
  }

  /** A transport whose socket exists but has never opened: nothing can be sent. */
  function downTransport() {
    const fakes = makeFakeSocketCtor();
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 1,
      retryTimeoutMs: 10_000,
      WebSocketImpl: fakes.ctor,
    });
    const socket = fakes.instances[0];
    expect(socket.readyState).not.toBe(1);
    return { transport, socket };
  }

  /** One client message as it went out on the wire, read back. */
  interface SentMessage {
    type: string;
    requestId?: string;
    centreId?: string;
    topic?: string;
  }

  /**
   * Everything this socket was handed, decoded, in order. `JSON.parse` hands
   * back `any`; the declared return type narrows it without an assertion.
   */
  function sentMessages(socket: { sent: string[] }): SentMessage[] {
    return socket.sent.map((raw) => JSON.parse(raw));
  }

  /** The `requestId`s of the command-requests this socket actually carried, in order. */
  function deliveredRequestIds(socket: { sent: string[] }): string[] {
    return sentMessages(socket)
      .filter((message) => message.type === "command-request")
      .map((message) => message.requestId ?? "");
  }

  /** Let the refusals, which are minted in a microtask, land. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("accounts for every command sent while the link is down: delivered or refused, never silently dropped", async () => {
    const { transport, socket } = downTransport();
    const errors: Array<{ requestId?: string; code: string }> = [];
    transport.onMessage((message) => {
      if (message.type === "error") errors.push(message);
    });

    const ids = Array.from({ length: 5_000 }, (_, i) => `r${i}`);
    for (const id of ids) transport.send(commandRequest(id));
    await flush();

    socket.fire("open");
    const delivered = deliveredRequestIds(socket);
    const refused = errors.map((error) => error.requestId);

    // The backlog is BOUNDED: an outage cannot make the transport hold
    // everything an operator (or an automation loop) ever pressed.
    expect(delivered.length).toBeLessThan(ids.length);
    // ...and nothing vanished on the way: the two outcomes partition the set.
    expect([...delivered, ...refused].sort()).toEqual([...ids].sort());
    // The survivors are the OLDEST, in order. A queue that evicted its head
    // would run the tail of an ordered dispatch sequence without its start.
    expect(delivered).toEqual(ids.slice(0, delivered.length));

    transport.dispose();
  });

  it("holds exactly MAX_PENDING_COMMANDS, refusing only past the cap", async () => {
    const atCap = downTransport();
    const refusedAtCap: string[] = [];
    atCap.transport.onMessage((message) => {
      if (message.type === "error") refusedAtCap.push(message.code);
    });
    for (let i = 0; i < MAX_PENDING_COMMANDS; i++) {
      atCap.transport.send(commandRequest(`r${i}`));
    }
    await flush();
    // A cap one too tight would refuse here, and the whole backlog is legitimate.
    expect(refusedAtCap).toEqual([]);
    atCap.socket.fire("open");
    expect(deliveredRequestIds(atCap.socket)).toHaveLength(
      MAX_PENDING_COMMANDS,
    );
    atCap.transport.dispose();

    const overCap = downTransport();
    const refusals: Array<{ requestId?: string; code: string }> = [];
    overCap.transport.onMessage((message) => {
      if (message.type === "error") refusals.push(message);
    });
    for (let i = 0; i <= MAX_PENDING_COMMANDS; i++) {
      overCap.transport.send(commandRequest(`r${i}`));
    }
    await flush();
    // The one past the cap is refused, and it is the NEWEST that is refused.
    expect(refusals).toHaveLength(1);
    expect(refusals[0].requestId).toBe(`r${MAX_PENDING_COMMANDS}`);
    expect(refusals[0].code).toBe(SEND_QUEUE_FULL);
    overCap.transport.dispose();
  });

  it("rejects a refused dispatch as `failed`, so the operator is told a retry may work", async () => {
    const { transport } = downTransport();
    const client = new TelemetryClient(transport);

    for (let i = 0; i < MAX_PENDING_COMMANDS; i++) {
      // Fill the queue. These stay in flight for the whole test and are
      // rejected by `dispose()`; swallow that, it is not what is under test.
      client.dispatch("vessel.stage").result.catch(() => {});
    }
    const overflow = client.dispatch("vessel.stage");

    // Raced against a short timer rather than awaited bare: a dispatch that is never answered is precisely the regression this guards, and it should read as one instead of consuming the whole test timeout in silence.
    const rejection = await Promise.race([
      overflow.result.then(
        () => null,
        (error: unknown) => classifyCommandRejection(error),
      ),
      new Promise<never>((_, fail) =>
        setTimeout(
          () => fail(new Error("the refused dispatch never settled")),
          1_000,
        ),
      ),
    ]);
    // NOT `lost`: nothing was decided over there because nothing ever left here, and `lost` warns that re-sending could double a command that may already have run.
    // `failed` is the honest one, and it is the outcome that invites the retry.
    expect(rejection?.kind).toBe("failed");
    expect(client.getCommand(overflow.requestId).phase).toBe("failed");

    client.dispose();
    transport.dispose();
  });

  /**
   * A transport whose link never comes back: every socket fails to connect, and
   * a monotonically advancing `now` walks past the retry budget so
   * `scheduleRetry` reaches its give-up branch. `giveUp()` drives it there.
   */
  function abandonedTransport() {
    const fakes = makeFakeSocketCtor();
    let elapsed = 0;
    const transport = new WebSocketTransport({
      url: SITREP_URL,
      retryIntervalMs: 1,
      retryTimeoutMs: 20,
      WebSocketImpl: fakes.ctor,
      now: () => {
        elapsed += 15;
        return elapsed;
      },
    });
    const giveUp = () =>
      vi.waitFor(
        () => {
          fakes.instances.at(-1)?.fire("close");
          expect(transport.status).toBe("disconnected");
        },
        { timeout: WAIT_TIMEOUT_MS },
      );
    return { transport, socket: fakes.instances[0], giveUp };
  }

  it("reports every command left in the queue when it stops retrying", async () => {
    const { transport, socket, giveUp } = abandonedTransport();
    const errors: Array<{ requestId?: string; code: string }> = [];
    const undelivered: Array<{ requestId: string; reason: string }> = [];
    transport.onMessage((message) => {
      if (message.type === "error") errors.push(message);
    });
    transport.onUndelivered((command) => undelivered.push(command));

    for (const id of ["r0", "r1", "r2"]) transport.send(commandRequest(id));
    await flush();
    // Well under the cap: nothing is refused at the press, so the only thing
    // that can ever account for these three is the give-up below.
    expect(errors).toEqual([]);

    await giveUp();
    await flush();

    // Every one of them, in the order they were pressed, and none of them on
    // any wire.
    expect(undelivered.map((command) => command.requestId)).toEqual([
      "r0",
      "r1",
      "r2",
    ]);
    expect(deliveredRequestIds(socket)).toEqual([]);
    /*
     * NOT on the error channel, which is the whole reason this one exists: an
     * `error` correlated to a requestId the client has already called `lost` is
     * read as proof the mod RECEIVED the command (`handleCommandError` flips it
     * to `found`), and these never left the machine.
     */
    expect(errors).toEqual([]);

    transport.dispose();
  });

  it("reports a stranded command once, and does not go on holding it", async () => {
    const { transport, giveUp } = abandonedTransport();
    const undelivered: string[] = [];
    transport.onUndelivered((command) => undelivered.push(command.requestId));

    transport.send(commandRequest("r0"));
    await giveUp();
    await flush();
    // A second give-up (a late `close` on a socket the loop already abandoned)
    // must not re-report a queue that is already empty.
    await giveUp();
    await flush();

    expect(undelivered).toEqual(["r0"]);
    transport.dispose();
  });

  it("says WHY, in words a surface can put in front of the operator", async () => {
    const { transport, giveUp } = abandonedTransport();
    const reasons: string[] = [];
    transport.onUndelivered((command) => reasons.push(command.reason));

    transport.send(commandRequest("r0"));
    await giveUp();
    await flush();

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/never (left|sent)|not sent/i);
    transport.dispose();
  });

  it("tells a stranded command it never left, rather than leaving it called lost", async () => {
    const { transport, giveUp } = abandonedTransport();
    const ut = new ManualClock(0);
    const client = new TelemetryClient(transport, ut);
    // 2s one way, as DelayAuthority reports it off `comms.delay`.
    client.setDelaySource(() => 2);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      (error: unknown) => classifyCommandRejection(error),
    );

    /*
     * The loss timer fires long before the transport gives up (a round trip
     * here is 4s, the give-up budget is minutes), so this is the state the
     * command is in when the link is abandoned.
     */
    ut.advanceTo(4 + LOSS_MARGIN);
    expect(client.getCommand(requestId).phase).toBe("lost");
    expect(await settled).toMatchObject({ kind: "lost" });

    await giveUp();
    await flush();

    // `lost` says WE DO NOT KNOW. Once the transport has stopped retrying we
    // know: it is still in the queue, it never reached a socket, so nothing
    // over there ran it. That is a stronger claim and it gets its own phase.
    expect(client.getCommand(requestId).phase).toBe("undelivered");
    // And emphatically not `found`, which asserts the mod received it.
    expect(client.getCommand(requestId).phase).not.toBe("found");

    client.dispose();
    transport.dispose();
  });

  it("settles a command still in flight when the link is abandoned", async () => {
    const { transport, giveUp } = abandonedTransport();
    // A clock that never advances: the loss timer is armed and never fires, so
    // nothing but the give-up can end this dispatch's wait.
    const client = new TelemetryClient(transport, new ManualClock(0));
    client.setDelaySource(() => 2);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      (error: unknown) => classifyCommandRejection(error),
    );

    await giveUp();
    await flush();

    const rejection = await Promise.race([
      settled,
      new Promise<never>((_, fail) =>
        setTimeout(
          () => fail(new Error("the stranded dispatch never settled")),
          1_000,
        ),
      ),
    ]);
    // `failed`, for the same reason the at-the-press refusal is: the command
    // never left this machine, so nothing was decided over there and a retry
    // cannot double it. The code is what separates it from a broken handler.
    expect(rejection).toMatchObject({
      kind: "failed",
      code: COMMAND_UNDELIVERED,
    });
    expect(client.getCommand(requestId).phase).toBe("undelivered");

    client.dispose();
    transport.dispose();
  });

  it("keeps only the latest vantage selection, and replays it before re-subscribing", () => {
    const { transport, socket } = downTransport();
    transport.send({ type: "subscribe", topic: "vessel.state" });
    for (const centreId of ["ksc", "woomera", "kourou"]) {
      transport.send({ type: "set-vantage", centreId });
    }

    socket.fire("open");
    const sent = sentMessages(socket);
    // One selection, the last one: a vantage is state, not a backlog, so the
    // superseded ones are dropped and nobody needs telling.
    expect(sent.filter((message) => message.type === "set-vantage")).toEqual([
      { type: "set-vantage", centreId: "kourou" },
    ]);
    // Before the re-subscribes, because the server reads the selected vantage
    // at subscribe time: replayed after, every topic re-points at the old one.
    expect(sent[0].type).toBe("set-vantage");
    expect(sent[1]).toEqual({ type: "subscribe", topic: "vessel.state" });

    transport.dispose();
  });
});
