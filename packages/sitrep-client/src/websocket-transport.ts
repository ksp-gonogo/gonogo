import type {
  ClientMessage,
  ServerMessage,
  StreamBinaryMessage,
} from "@ksp-gonogo/sitrep-sdk";
import {
  decodeBinaryFrame,
  FaultCode,
  frameBytes,
  isBinaryFrame,
  parseServerMessage,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  Transport,
  TransportStatus,
  UndeliveredCommand,
} from "./transport";

/**
 * Minimal structural view of the parts of the DOM `WebSocket` this transport
 * touches: enough to construct, listen, send, close, and read `readyState`.
 * Declared locally (rather than leaning on `lib.dom`'s global `WebSocket`) so
 * the class stays injectable: a test can hand in any conforming
 * constructor, and the default is the ambient global. MSW's `ws` interceptor
 * patches that same global, which is why the network-boundary tests need no
 * injection at all.
 */
export interface WebSocketLike {
  readonly readyState: number;
  /**
   * Frame delivery mode for binary messages. The mod server (Fleck) sends
   * stream frames as BINARY WebSocket frames; the DOM default `"blob"` would
   * deliver them as `Blob`s (async to read, which reorders the stream), so the
   * transport requests `"arraybuffer"` for synchronous decode. Optional/
   * writable so injected test sockets that don't model it are unaffected.
   */
  binaryType?: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}

export interface WebSocketCtor {
  new (url: string): WebSocketLike;
  readonly OPEN: number;
}

/** Reported to the caller for each delivered `stream-data` frame, the perf-budget seam (see `onStreamFrame`). */
export interface StreamFrameInfo {
  topic: string;
  /** Length of the raw wire text of this frame, in UTF-16 code units (cheap `string.length`, not a UTF-8 byte count). */
  byteLength: number;
}

/** Reported to the caller for each delivered BINARY-LANE frame (see `onBinaryFrame`). */
export interface BinaryFrameInfo {
  topic: string;
  /** How many segments this frame batched. The lane exists so this is usually well above 1. */
  segments: number;
  /** Total payload bytes across every segment: a real byte count, unlike `StreamFrameInfo.byteLength`. */
  byteLength: number;
}

export interface WebSocketTransportOptions {
  /** Full `ws://host:port/...` URL to connect to. Mutually exclusive with `host`/`port`. */
  url?: string;
  /** Host to connect to (default `localhost`). Ignored when `url` is given. */
  host?: string;
  /** Port to connect to (default `8090`). Ignored when `url` is given. */
  port?: number;
  /** Delay before the first reconnect attempt, ms (default 5000). It doubles per consecutive failed attempt up to {@link maxRetryIntervalMs}. */
  retryIntervalMs?: number;
  /** Ceiling the doubling retry delay settles at, ms (default 30000). */
  maxRetryIntervalMs?: number;
  /**
   * How long a subscribed, open socket may deliver nothing before the transport
   * asks the server something it must answer, ms (default 30000; 0 turns the
   * watchdog off).
   *
   * A tunnel or proxy can keep the TCP leg to the browser open after the
   * server behind it has gone, so no `close` ever fires. Silence alone proves
   * nothing, since a quiet scene may publish nothing for longer than this: the
   * socket is dropped only if the probe goes unanswered for
   * {@link probeTimeoutMs}.
   */
  silenceTimeoutMs?: number;
  /** How long the answer to a liveness probe may take before the socket is dropped, ms (default 5000). */
  probeTimeoutMs?: number;
  /**
   * How long a command may wait for a link that is down before it is handed
   * back through `onUndelivered`, ms (default 5 min). The transport itself
   * never stops retrying: this bounds only how stale a queued command may be
   * when the link finally returns.
   */
  commandHoldMs?: number;
  /**
   * Called once per delivered `stream-data` frame: the perf-budget seam.
   * `@ksp-gonogo/sitrep-client` deliberately does NOT depend on `@ksp-gonogo/core`
   * (that would be a cycle: core imports this package), so the `PerfBudget`
   * itself lives in the app layer and records from this callback.
   */
  onStreamFrame?: (info: StreamFrameInfo) => void;
  /**
   * Called once per delivered BINARY-LANE frame: that lane's own perf-budget
   * seam, deliberately NOT `onStreamFrame`.
   *
   * A media lane and a ~1 Hz state stream do not belong on one counter. Mixed,
   * the combined rate describes neither, and the media traffic spends headroom
   * that was sized for state. Same layering as `onStreamFrame`: the `PerfBudget`
   * lives in the app, because `@ksp-gonogo/sitrep-client` must not depend on
   * `@ksp-gonogo/core`.
   */
  onBinaryFrame?: (info: BinaryFrameInfo) => void;
  /** Inject a `WebSocket` constructor (default: the ambient global). Tests that don't use MSW can pass a fake. */
  WebSocketImpl?: WebSocketCtor;
  /** Wall-clock source for the command-hold budget (default `Date.now`). Injectable for deterministic tests. */
  now?: () => number;
}

/** Shared UTF-8 decoder for binary stream frames (module scope, stateless, reused per frame). */
const FRAME_TEXT_DECODER = new TextDecoder();

/**
 * Which lane a frame arrived on, and what came off it.
 *
 * `unreadable` is the arm that keeps absence honest: it is NOT the same as a
 * frame the transport chose to ignore. It carries the reason so the drop can be
 * said out loud, because the failures it covers (an unknown lane, a truncated
 * frame) all look exactly like silence from a widget's point of view.
 */
type DecodedFrame =
  | { lane: "text"; text: string }
  | { lane: "binary"; message: StreamBinaryMessage }
  | { lane: "unreadable"; reason: string };

/**
 * Split a WebSocket message onto its lane.
 *
 * Handles the string frames the test harnesses (MSW/stub) send AND the binary
 * (`ArrayBuffer` / typed-array) frames the real mod server sends. Note both
 * lanes arrive as WebSocket BINARY frames in production: the discriminator is
 * the first BYTE, not the frame's own type, because the mod has always written
 * its JSON as binary (`Fleck.Send(byte[])`).
 *
 * A `Blob` (only reachable if an injected socket ignores `binaryType`) is
 * dropped rather than read asynchronously, which would reorder the stream.
 */
function decodeFrame(data: unknown): DecodedFrame | null {
  if (typeof data === "string") return { lane: "text", text: data };

  const resolveBytes = (): Uint8Array | null => {
    if (data instanceof ArrayBuffer) return frameBytes(data);
    if (ArrayBuffer.isView(data)) return frameBytes(data as ArrayBufferView);
    return null;
  };
  const bytes = resolveBytes();
  if (bytes === null) return null;

  if (!isBinaryFrame(bytes)) {
    return { lane: "text", text: FRAME_TEXT_DECODER.decode(bytes) };
  }

  const decoded = decodeBinaryFrame(bytes);
  if (decoded.ok) return { lane: "binary", message: decoded.message };
  /* `not-binary` cannot reach here: `isBinaryFrame` just said otherwise. */
  return { lane: "unreadable", reason: decoded.reason };
}

const DEFAULT_PORT = 8090;
const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_COMMAND_HOLD_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_SILENCE_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * The topic a liveness probe subscribes to. Nothing declares it, so the mod
 * refuses the subscribe with a reliable `unknownTopic` error frame on every
 * call and registers nothing: the one request the protocol always answers,
 * whatever the scene is publishing. The transport swallows that reply, so it
 * never reaches the client's ownership bookkeeping.
 */
export const LIVENESS_PROBE_TOPIC = "liveness.probe";

/**
 * How many undelivered command-requests the transport holds for the next open.
 *
 * The queue exists so a command pressed during a blink of the link still gets
 * there; it is not storage for a whole outage. Sized well above any plausible
 * burst of operator presses or automation dispatches across a few reconnect
 * intervals, and far below the point where the backlog is the reason the tab
 * stops working: an unbounded queue is what a tab left open through a long
 * outage used to grow.
 */
export const MAX_PENDING_COMMANDS = 64;

/** The `code` on the synthetic `error` a refused command-request is answered with. */
export const SEND_QUEUE_FULL = FaultCode.SendQueueFull;

/**
 * What the operator is told about a command that was still queued when the
 * outage outlasted the hold window.
 *
 * Says the thing that is TRUE and useful, and stops there: it never left, so
 * nothing over there ran it, so sending it again cannot do it twice. That last
 * clause is the whole difference between this and a lost command, which carries
 * the opposite advice for the opposite reason.
 */
export const UNDELIVERED_REASON =
  "not sent: the link did not come back in time. It never left this " +
  "machine, so nothing ran it. Send it again once the link is back.";

/** The request ids a queued frame answers for: a group's frame is one queue slot and answers for each member. */
function requestIdsOf(
  message: Extract<
    ClientMessage,
    { type: "command-request" | "command-group" }
  >,
): string[] {
  return message.type === "command-group"
    ? message.members.map((member) => member.requestId)
    : [message.requestId];
}

/**
 * A live `Transport` over a Sitrep mod WebSocket (`ws://<host>:<port>`,
 * default port 8090: the `GonogoAddon`/Fleck server).
 *
 * Owns its own socket lifecycle (opens in the constructor, like
 * `ReplayTransport`) and is robust the same way the retired legacy WS
 * client was: capped-backoff reconnect that never gives up, clean
 * `connected`/`reconnecting`/`disconnected`/`error` status transitions, and
 * re-subscription of every still-active topic on every fresh connection.
 *
 * **Wire decode** reuses `parseServerMessage` (`@ksp-gonogo/sitrep-sdk`): the
 * exact decode path proven against real engine output by
 * `reference-wire-fixture.test.ts`; nothing is re-implemented here.
 */
export class WebSocketTransport implements Transport {
  /**
   * This is the connection that owns its own `ClientSession` with the mod, so
   * the `subscribed` acks it receives are answers to its OWN subscribes and a
   * missing one is real evidence that nothing will ever publish the topic.
   *
   * The only transport in the tree that opts in. See
   * `Transport.decidesTopicOwnership` for why the default is the other way.
   */
  readonly decidesTopicOwnership = true;
  private _status: TransportStatus = "reconnecting";

  private readonly url: string;
  private readonly retryIntervalMs: number;
  private readonly maxRetryIntervalMs: number;
  private readonly silenceTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly commandHoldMs: number;
  private readonly onStreamFrame?: (info: StreamFrameInfo) => void;
  private readonly onBinaryFrame?: (info: BinaryFrameInfo) => void;
  private readonly WebSocketImpl: WebSocketCtor;
  private readonly now: () => number;

  private ws: WebSocketLike | null = null;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStart: number | null = null;
  private failedAttempts = 0;
  private unwatchEnvironment: (() => void) | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();
  private readonly undeliveredListeners = new Set<
    (command: UndeliveredCommand) => void
  >();

  /** Topics with a live `subscribe` (no matching `unsubscribe`), re-sent on every fresh open. */
  private readonly subscribedTopics = new Set<string>();
  /**
   * Command-requests issued while the socket wasn't open, flushed on open.
   * Capped at {@link MAX_PENDING_COMMANDS}; see {@link send} for what happens
   * to the one that does not fit.
   */
  private readonly pendingCommands: Array<
    Extract<ClientMessage, { type: "command-request" | "command-group" }>
  > = [];
  /**
   * The vantage this connection has selected, replayed on every fresh open.
   *
   * State, not a queued message, which is why it does not share the command
   * queue's cap: a selection supersedes the one before it, so switching
   * command centre repeatedly during an outage can only ever leave one. It is
   * also why it is replayed on EVERY open rather than only when one was missed:
   * a reconnect gets a new `ClientSession` on the mod, whose `SelectedVantage`
   * defaults back to `ksc`, and a client that did not re-assert its selection
   * would go on naming a command centre its data is not from.
   */
  private selectedVantage: string | null = null;

  constructor(options: WebSocketTransportOptions = {}) {
    this.url =
      options.url ??
      `ws://${options.host ?? "localhost"}:${options.port ?? DEFAULT_PORT}`;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.commandHoldMs = options.commandHoldMs ?? DEFAULT_COMMAND_HOLD_MS;
    this.maxRetryIntervalMs =
      options.maxRetryIntervalMs ?? DEFAULT_MAX_RETRY_INTERVAL_MS;
    this.silenceTimeoutMs =
      options.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.onStreamFrame = options.onStreamFrame;
    this.onBinaryFrame = options.onBinaryFrame;
    /* The DOM's constructor and this transport's minimal one differ in the
       members neither side calls, so the platform's is adopted by shape. */
    this.WebSocketImpl =
      options.WebSocketImpl ?? (globalThis.WebSocket as WebSocketCtor);
    this.now = options.now ?? (() => Date.now());

    this.watchEnvironment();
    this.open();
  }

  get status(): TransportStatus {
    return this._status;
  }

  /**
   * Hand a message to the socket, or hold what can be held until the next open.
   *
   * The message types that reach here fall into two kinds, and they do not want
   * the same treatment while the link is down. Subscriptions and the vantage
   * selection are STATE: the live set is replayed on every open, so one sent
   * into a dead socket costs nothing and needs no queue. A command-request is
   * an EVENT: it happened once, nothing replays it, and dropping one is a real
   * loss.
   *
   * So only commands queue, and the queue is bounded. Past the cap the NEWEST
   * is refused rather than the oldest evicted, for two reasons:
   *
   * - the backlog drains in order on reconnect, and a sequence whose head was
   *   evicted runs its tail without its start (an ordered burn sequence,
   *   `ManeuverPlanner.dispatchPlanBurns`, is exactly that shape). Refusing
   *   admission keeps whatever WAS accepted an unbroken prefix
   * - the refusal is minted AT THE PRESS, while the command is still
   *   `in-flight`, so `TelemetryClient` settles it `failed`. A late eviction
   *   would land after the client's own loss timer had already called the
   *   command `lost`, and an `error` correlated to a lost requestId is read as
   *   proof the mod received it (`handleCommandError` flips it to `found`).
   *   Evicting later would therefore have to lie about where the command got to
   *
   * A queue also needs an END, and the cap is not one: what is admitted still
   * has to be answered if the link never returns. {@link abandonQueue} is that
   * answer, on a channel of its own for the reason the second bullet gives.
   */
  send(message: ClientMessage): void {
    if (message.type === "subscribe") {
      this.subscribedTopics.add(message.topic);
      this.sendRaw(message);
      this.armSilenceWatch();
      return;
    }
    if (message.type === "unsubscribe") {
      this.subscribedTopics.delete(message.topic);
      this.sendRaw(message);
      if (this.subscribedTopics.size === 0) this.stopSilenceWatch();
      return;
    }
    if (message.type === "set-vantage") {
      this.selectedVantage = message.centreId;
      this.sendRaw(message);
      return;
    }
    if (this.sendRaw(message)) return;
    if (this.pendingCommands.length >= MAX_PENDING_COMMANDS) {
      for (const requestId of requestIdsOf(message)) {
        this.refuseCommand(requestId);
      }
      return;
    }
    this.pendingCommands.push(message);
  }

  /**
   * Answer a command the transport will not carry, on the same channel a
   * server-side failure would arrive on, so `TelemetryClient` settles the
   * dispatch promise as `failed` and the operator gets told rather than left
   * watching an in-flight rail that will never move. Same shape as
   * `PeerTransport`'s `E_PEER_DISCONNECTED` refusal, including the deferral to
   * a later tick so it never settles inside the caller's own `dispatch()`.
   *
   * `failed` and not `lost` is the honest half: the command never left this
   * machine, so nothing was decided over there and a retry cannot double
   * anything.
   */
  private refuseCommand(requestId: string): void {
    queueMicrotask(() =>
      this.deliver({
        type: "error",
        requestId,
        code: SEND_QUEUE_FULL,
        message:
          `not sent: ${MAX_PENDING_COMMANDS} commands are already waiting for ` +
          "the link to come back. Retry once it does.",
      }),
    );
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** See `Transport.onUndelivered`, and {@link abandonQueue} for when it fires. */
  onUndelivered(listener: (command: UndeliveredCommand) => void): () => void {
    this.undeliveredListeners.add(listener);
    return () => this.undeliveredListeners.delete(listener);
  }

  /**
   * Permanently tear down: stop retrying, close the socket, and drop all
   * listeners. Idempotent. After this the transport never reconnects, a new
   * instance is required (matches `ReplayTransport.stop`'s finality).
   */
  dispose(): void {
    this.disposed = true;
    this.stopRetrying();
    this.stopSilenceWatch();
    this.unwatchEnvironment?.();
    this.unwatchEnvironment = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.undeliveredListeners.clear();
    this.setStatus("disconnected");
  }

  private open(): void {
    if (this.disposed) return;
    const old = this.ws;
    this.ws = null;
    old?.close();

    let ws: WebSocketLike;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch {
      // Constructor threw synchronously (e.g. a malformed URL); treat it the same as a failed connection so the retry loop still governs.
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    // The mod server sends stream frames as BINARY WebSocket frames. Request
    // ArrayBuffer delivery so `handleMessage` can decode them synchronously,
    // the browser default is `"blob"`, whose async `.text()` read would both
    // drop frames on the floor here (the old `typeof data !== "string"` guard)
    // and reorder the stream. Guarded because injected/test sockets need not
    // model `binaryType`.
    if ("binaryType" in ws) ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      // The outage clock measures the CURRENT outage, not the whole session: a successful open starts the next drop's command-hold window afresh.
      this.retryStart = null;
      this.failedAttempts = 0;
      this.setStatus("connected");
      // Re-assert the vantage FIRST: the mod reads the session's selected vantage at subscribe time, so a re-subscribe sent ahead of it would re-point every topic at the fresh session's default.
      if (this.selectedVantage !== null) {
        this.sendRaw({ type: "set-vantage", centreId: this.selectedVantage });
      }
      // Re-subscribe to everything still active, then drain queued commands.
      for (const topic of this.subscribedTopics) {
        this.sendRaw({ type: "subscribe", topic });
      }
      const queued = this.pendingCommands.splice(0);
      for (const message of queued) this.sendRaw(message);
      this.armSilenceWatch();
    });
    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) return;
      this.armSilenceWatch();
      this.handleMessage(event.data);
    });
    // Both `close` and `error` route through the same drop handler. An `error`
    // that never fires `close` would otherwise strand the transport (Fix #2);
    // and a socket firing `close` twice would otherwise pass the guard twice,
    // leaking a retry timer and double-opening (Fix #3). `handleDrop` nulls
    // `this.ws` on the first event so any second event on the same socket is
    // ignored by the `this.ws === ws` guard.
    ws.addEventListener("close", () => this.handleDrop(ws));
    ws.addEventListener("error", () => this.handleDrop(ws));
  }

  /**
   * A socket dropped (closed or errored). Idempotent per socket: the first
   * event nulls `this.ws`, so a follow-up `close` after an `error` (or a
   * double `close`) is a no-op.
   */
  private handleDrop(ws: WebSocketLike): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.stopSilenceWatch();
    // Defensive close for the error path (harmless on an already-closed socket) so a stuck-open socket can't linger while we reconnect.
    try {
      ws.close();
    } catch {
      // ignore: best-effort teardown
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.retryStart === null) this.retryStart = this.now();
    this.expireStaleCommands();

    this.setStatus("reconnecting");
    const delay = Math.min(
      this.retryIntervalMs * 2 ** this.failedAttempts,
      Math.max(this.maxRetryIntervalMs, this.retryIntervalMs),
    );
    // Capped well below the exponent's overflow: the delay is already pinned to the ceiling long before this stops growing.
    this.failedAttempts = Math.min(this.failedAttempts + 1, 30);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /**
   * Skip the wait: if a retry is pending, open the next socket now and start
   * the backoff over. A no-op while connected, while an attempt is already in
   * flight, and after `dispose`.
   */
  retryNow(): void {
    if (this.disposed || this.retryTimer === null) return;
    this.stopRetrying();
    this.failedAttempts = 0;
    this.open();
  }

  /**
   * A tab that comes back to the foreground, or a network that comes back, is
   * the moment a wait on a long backoff is most likely to be wasted, so both
   * retry at once.
   */
  private watchEnvironment(): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") this.retryNow();
    };
    const onOnline = () => this.retryNow();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    this.unwatchEnvironment = () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }

  /**
   * Hand back the queued commands once the outage has outlasted
   * {@link WebSocketTransportOptions.commandHoldMs}. A command is an event that
   * happened once, and one that fires minutes later, when the game finally
   * returns, does something the operator no longer expects.
   */
  private expireStaleCommands(): void {
    if (this.retryStart === null) return;
    if (this.now() - this.retryStart < this.commandHoldMs) return;
    this.abandonQueue();
  }

  /**
   * (Re)start the dead-socket countdown. Runs only while the socket is open
   * and something is subscribed: with nothing subscribed the server has
   * nothing to say, so silence proves nothing.
   */
  private armSilenceWatch(): void {
    this.stopSilenceWatch();
    if (this.silenceTimeoutMs <= 0 || this.disposed) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WebSocketImpl.OPEN) return;
    if (this.subscribedTopics.size === 0) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (!this.sendRaw({ type: "subscribe", topic: LIVENESS_PROBE_TOPIC })) {
        this.handleDrop(ws);
        return;
      }
      // Any frame at all, the probe's reply or ordinary data, re-arms the watch and clears this timer.
      this.probeTimer = setTimeout(() => {
        this.probeTimer = null;
        this.handleDrop(ws);
      }, this.probeTimeoutMs);
    }, this.silenceTimeoutMs);
  }

  private stopSilenceWatch(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.probeTimer !== null) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  /**
   * Hand back every command still waiting for a link that has stayed down
   * past the hold window.
   *
   * The queue is bounded, so nothing grows without limit; what it was still
   * missing is an END. A command left here for hours would fire whenever the
   * game finally returns, long after the operator stopped expecting it, and
   * would never have been mentioned in between.
   *
   * Drained rather than kept, because holding what has already been accounted
   * for is how a later expiry reports the same command twice.
   *
   * Not called from `dispose()`, which is the other permanent end and is
   * already answered: `TelemetryClient.dispose` rejects every command still in
   * flight (`E_DISPOSED`), so nothing is silent there. This is the path with no
   * such backstop.
   */
  private abandonQueue(): void {
    const stranded = this.pendingCommands.splice(0);
    for (const requestId of stranded.flatMap(requestIdsOf)) {
      for (const listener of this.undeliveredListeners) {
        try {
          listener({ requestId, reason: UNDELIVERED_REASON });
        } catch (error) {
          // One throwing listener must not strand the commands behind it, the same isolation contract `deliver` holds for message fan-out.
          console.error(
            "WebSocketTransport: undelivered listener threw",
            error,
          );
        }
      }
    }
  }

  private stopRetrying(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Serialise + send if the socket is open. Returns whether it was actually sent. */
  private sendRaw(message: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WebSocketImpl.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  private handleMessage(data: unknown): void {
    const frame = decodeFrame(data);
    if (frame === null) return;

    if (frame.lane === "unreadable") {
      /*
       * SAID, not swallowed. Every other drop on this path is a malformed
       * JSON envelope, which a client cannot do anything about and which the
       * mod would already have logged. These are different: an unknown lane
       * means this client is older than the mod, and a truncated frame means
       * the transmission genuinely lost bytes. Both are indistinguishable
       * from a quiet channel at every layer above, so the console line is the
       * only place the difference is ever visible.
       */
      console.warn(
        `WebSocketTransport: unreadable frame dropped, ${frame.reason}`,
      );
      return;
    }

    if (frame.lane === "binary") {
      this.handleBinaryFrame(frame.message);
      return;
    }

    let message: ServerMessage;
    try {
      message = parseServerMessage(frame.text);
    } catch {
      // Malformed / unknown envelope: drop it, same posture as the legacy data source's own JSON guard.
      return;
    }

    // The probe's own reply: it proved the link is alive by arriving, and means nothing to anything above.
    if (message.type === "error" && message.topic === LIVENESS_PROBE_TOPIC) {
      return;
    }

    if (message.type === "stream-data") {
      this.onStreamFrame?.({
        topic: message.topic,
        byteLength: frame.text.length,
      });
    }

    this.deliver(message);
  }

  /**
   * A delivery off the binary lane.
   *
   * Reported on {@link WebSocketTransportOptions.onBinaryFrame} rather than
   * `onStreamFrame`.
   *
   * **The separate seam is the point, not a tidiness.** `onStreamFrame` feeds a
   * budget sized against a roughly-1 Hz state stream; folding a media lane into
   * the same counter makes the combined number mean nothing, and the media
   * traffic eats headroom that was measured for something else. Two seams, two
   * budgets, two numbers that each still describe one thing.
   */
  private handleBinaryFrame(message: StreamBinaryMessage): void {
    let byteLength = 0;
    for (const segment of message.segments) byteLength += segment.byteLength;
    this.onBinaryFrame?.({
      topic: message.topic,
      segments: message.segments.length,
      byteLength,
    });
    this.deliver(message);
  }

  /** Fan one server message out to every listener. */
  private deliver(message: ServerMessage): void {
    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        // One throwing listener must not starve the rest of fan-out, same isolation contract as StubTransport/ReplayTransport.
        console.error("WebSocketTransport: message listener threw", error);
      }
    }
  }

  private setStatus(status: TransportStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
