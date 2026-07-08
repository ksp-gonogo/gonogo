import type { ClientMessage, ServerMessage } from "@gonogo/sitrep-sdk";
import { parseServerMessage } from "@gonogo/sitrep-sdk";
import type { Transport, TransportStatus } from "./transport";

/**
 * Minimal structural view of the parts of the DOM `WebSocket` this transport
 * touches — enough to construct, listen, send, close, and read `readyState`.
 * Declared locally (rather than leaning on `lib.dom`'s global `WebSocket`) so
 * the class stays injectable: a test can hand in any conforming
 * constructor, and the default is the ambient global. MSW's `ws` interceptor
 * patches that same global, which is why the network-boundary tests need no
 * injection at all.
 */
export interface WebSocketLike {
  readonly readyState: number;
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

/** Reported to the caller for each delivered `stream-data` frame — the perf-budget seam (see `onStreamFrame`). */
export interface StreamFrameInfo {
  topic: string;
  /** Length of the raw wire text of this frame, in UTF-16 code units (cheap `string.length`, not a UTF-8 byte count). */
  byteLength: number;
}

export interface WebSocketTransportOptions {
  /** Full `ws://host:port/...` URL to connect to. Mutually exclusive with `host`/`port`. */
  url?: string;
  /** Host to connect to (default `localhost`). Ignored when `url` is given. */
  host?: string;
  /** Port to connect to (default `8090`). Ignored when `url` is given. */
  port?: number;
  /** Delay between reconnect attempts, ms (default 5000). */
  retryIntervalMs?: number;
  /** Give up (settle to `disconnected`) after this long retrying, ms (default 5 min). */
  retryTimeoutMs?: number;
  /**
   * Called once per delivered `stream-data` frame — the perf-budget seam.
   * `@gonogo/sitrep-client` deliberately does NOT depend on `@gonogo/core`
   * (that would be a cycle: core imports this package), so the `PerfBudget`
   * itself lives in the app layer and records from this callback.
   */
  onStreamFrame?: (info: StreamFrameInfo) => void;
  /** Inject a `WebSocket` constructor (default: the ambient global). Tests that don't use MSW can pass a fake. */
  WebSocketImpl?: WebSocketCtor;
  /** Wall-clock source for the retry-timeout budget (default `Date.now`). Injectable for deterministic tests. */
  now?: () => number;
}

const DEFAULT_PORT = 8090;
const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_RETRY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A live `Transport` over a Sitrep mod WebSocket (`ws://<host>:<port>`,
 * default port 8090 — the `GonogoAddon`/Fleck server).
 *
 * Owns its own socket lifecycle (opens in the constructor, like
 * `ReplayTransport`) and mirrors `TelemachusDataSource.openWebSocket`'s
 * robustness: fixed-interval reconnect with an overall give-up timeout, clean
 * `connected`/`reconnecting`/`disconnected`/`error` status transitions, and
 * re-subscription of every still-active topic on every fresh connection.
 *
 * **Wire decode** reuses `parseServerMessage` (`@gonogo/sitrep-sdk`) — the
 * exact decode path proven against real engine output by
 * `reference-wire-fixture.test.ts`; nothing is re-implemented here.
 *
 * **`carriedChannels`** — the mod server does NOT (yet) advertise a
 * channel list on connect (no hello/handshake frame exists in
 * `mod/Sitrep.Transport`/`GonogoAddon`), so this transport falls back to the
 * documented behaviour in the browser-transport brief: it marks a channel
 * carried the first time a `stream-data` frame for it arrives. NOTE the
 * consequence — this set starts EMPTY and grows only as data flows, and it is
 * read once by `TelemetryClient.declaredChannels` at provider-mount time, so
 * it does NOT retroactively flip the carried-channels gate for a topic that
 * arrives later. The reliable way to promote a topic to the stream today is
 * the explicit `carriedChannels` prop on `<TelemetryProvider>` (the dev-first
 * per-topic opt-in); this dynamic set is best-effort/observational until the
 * server grows a real channel-advertisement handshake.
 */
export class WebSocketTransport implements Transport {
  private _status: TransportStatus = "reconnecting";

  private readonly url: string;
  private readonly retryIntervalMs: number;
  private readonly retryTimeoutMs: number;
  private readonly onStreamFrame?: (info: StreamFrameInfo) => void;
  private readonly WebSocketImpl: WebSocketCtor;
  private readonly now: () => number;

  private ws: WebSocketLike | null = null;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStart: number | null = null;

  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: TransportStatus) => void
  >();

  /** Topics with a live `subscribe` (no matching `unsubscribe`) — re-sent on every fresh open. */
  private readonly subscribedTopics = new Set<string>();
  /** Non-subscribe messages (command-requests) issued while the socket wasn't open — flushed on open. */
  private readonly pendingSends: ClientMessage[] = [];
  private readonly carried = new Set<string>();

  constructor(options: WebSocketTransportOptions = {}) {
    this.url =
      options.url ??
      `ws://${options.host ?? "localhost"}:${options.port ?? DEFAULT_PORT}`;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.retryTimeoutMs = options.retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;
    this.onStreamFrame = options.onStreamFrame;
    this.WebSocketImpl =
      options.WebSocketImpl ??
      (globalThis.WebSocket as unknown as WebSocketCtor);
    this.now = options.now ?? (() => Date.now());

    this.open();
  }

  get status(): TransportStatus {
    return this._status;
  }

  get carriedChannels(): readonly string[] {
    return [...this.carried];
  }

  send(message: ClientMessage): void {
    if (message.type === "subscribe") {
      this.subscribedTopics.add(message.topic);
      this.sendRaw(message);
      return;
    }
    if (message.type === "unsubscribe") {
      this.subscribedTopics.delete(message.topic);
      this.sendRaw(message);
      return;
    }
    // command-request: deliver now if we can, otherwise queue for the next open.
    if (!this.sendRaw(message)) this.pendingSends.push(message);
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Permanently tear down: stop retrying, close the socket, and drop all
   * listeners. Idempotent. After this the transport never reconnects — a new
   * instance is required (matches `ReplayTransport.stop`'s finality).
   */
  dispose(): void {
    this.disposed = true;
    this.stopRetrying();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.setStatus("disconnected");
  }

  // --- internals ---

  private open(): void {
    if (this.disposed) return;
    const old = this.ws;
    this.ws = null;
    old?.close();

    let ws: WebSocketLike;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch {
      // Constructor threw synchronously (e.g. a malformed URL) — treat it the
      // same as a failed connection so the retry loop still governs.
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      // Reset the give-up window: it measures the CURRENT outage, not the whole
      // session. A successful open means we're healthy again, so the next drop
      // starts a fresh `retryTimeoutMs` budget. Without this, `retryStart` is
      // pinned to the first-ever drop and any later drop more than
      // `retryTimeoutMs` of wall-clock after it would give up with zero
      // retries — fatal for hours-long sessions.
      this.retryStart = null;
      this.setStatus("connected");
      // Re-subscribe to everything still active, then drain queued commands.
      for (const topic of this.subscribedTopics) {
        this.sendRaw({ type: "subscribe", topic });
      }
      const queued = this.pendingSends.splice(0);
      for (const message of queued) this.sendRaw(message);
    });
    ws.addEventListener("message", (event) => {
      if (this.ws === ws) this.handleMessage(event.data);
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
    // Defensive close for the error path (harmless on an already-closed socket)
    // so a stuck-open socket can't linger while we reconnect.
    try {
      ws.close();
    } catch {
      // ignore — best-effort teardown
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.retryStart === null) this.retryStart = this.now();

    if (this.now() - this.retryStart >= this.retryTimeoutMs) {
      this.retryStart = null;
      this.setStatus("disconnected"); // gave up — a manual reconnect is needed
      return;
    }

    this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, this.retryIntervalMs);
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
    if (typeof data !== "string") return;
    let message: ServerMessage;
    try {
      message = parseServerMessage(data);
    } catch {
      // Malformed / unknown envelope — drop it, same posture as the
      // Telemachus data source's own JSON guard.
      return;
    }

    if (message.type === "stream-data") {
      this.carried.add(message.topic);
      this.onStreamFrame?.({ topic: message.topic, byteLength: data.length });
    }

    for (const listener of this.messageListeners) {
      try {
        listener(message);
      } catch (error) {
        // One throwing listener must not starve the rest of fan-out — same
        // isolation contract as StubTransport/ReplayTransport.
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
