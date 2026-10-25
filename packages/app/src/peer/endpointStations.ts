import { logger } from "@ksp-gonogo/logger";
import { encodeFrames, FrameReader } from "./endpointFraming";
import { TypedListeners } from "./typedListeners";

/** Where a station on the endpoint is: the home network or the internet. */
export type EndpointPath = "lan" | "internet";

type LinkEvents = {
  open: [];
  data: [data: unknown];
  close: [];
  error: [err: Error];
};

/**
 * One station joined through the endpoint, as the main screen sees it. It
 * has the same shape the main screen uses for a PeerJS data connection
 * (`peer`, `open`, `send`, `on`, `close`), so a station is served the same
 * way whichever path it joined by.
 */
export class EndpointConnection {
  open = false;
  /** Set when the endpoint reports the station's data channel open. */
  path: EndpointPath | null = null;
  private readonly events = new TypedListeners<LinkEvents>();
  private readonly reader = new FrameReader();
  private closed = false;

  constructor(
    /** The station's broker peer id, which approvals and every per-station record are keyed by. */
    readonly peer: string,
    readonly sid: number,
    private readonly sendFrame: (sid: number, frame: Uint8Array) => void,
    private readonly sendClose: (sid: number) => void,
  ) {}

  on<E extends keyof LinkEvents>(
    event: E,
    cb: (...args: LinkEvents[E]) => void,
  ): void {
    this.events.on(event, cb);
  }

  send(message: unknown): void {
    if (!this.open) return;
    for (const frame of encodeFrames(message)) this.sendFrame(this.sid, frame);
  }

  /** The endpoint always lets what the station has been sent drain before it closes. */
  close(_options?: { flush?: boolean }): void {
    if (this.closed) return;
    this.sendClose(this.sid);
    this.markClosed();
  }

  /** @internal */
  markOpen(path: EndpointPath | null): void {
    if (this.closed || this.open) return;
    this.open = true;
    this.path = path;
    this.events.emit("open");
  }

  /** @internal */
  receive(frame: Uint8Array): void {
    if (!this.open) return;
    const message = this.reader.push(frame);
    if (message !== undefined) this.events.emit("data", message);
  }

  /** @internal */
  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.events.emit("close");
  }
}

/** What the endpoint says about itself when the main screen connects. */
export interface EndpointStatus {
  /** The one port, UDP and TCP, stations connect on. */
  port: number;
  /** The router's public address the endpoint advertises, or null when it found none. */
  publicIp: string | null;
}

interface ControlFrame {
  type?: unknown;
  port?: unknown;
  publicIp?: unknown;
  sid?: unknown;
  sdp?: unknown;
  reason?: unknown;
  path?: unknown;
}

interface PendingJoin {
  conn: EndpointConnection;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ANSWER_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * The main screen's socket to the relay's station endpoint. Every station
 * that joins from another network, or from this one while the endpoint is
 * up, is carried on it: the main screen sends the station's offer, gets the
 * endpoint's answer for the station, then exchanges that station's messages
 * through the socket, each binary frame tagged with the station's session id.
 * The socket reconnects on its own, and while it is down `available` is
 * false and stations join the main screen directly.
 */
export class EndpointStations {
  private socket: WebSocket | null = null;
  private up = false;
  private current: EndpointStatus | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSid = 1;
  private readonly links = new Map<number, EndpointConnection>();
  private readonly pending = new Map<number, PendingJoin>();
  private readonly events = new TypedListeners<{ available: [up: boolean] }>();

  constructor(private readonly url: () => string) {}

  /** Whether the endpoint is there to take a station now. */
  get available(): boolean {
    return this.up;
  }

  /** The endpoint's port and public address while it is up, else null. */
  get status(): EndpointStatus | null {
    return this.up ? this.current : null;
  }

  onAvailable(cb: (up: boolean) => void): () => void {
    return this.events.on("available", cb);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.lost();
  }

  /**
   * Hand a station's offer to the endpoint. The connection that will carry
   * the station comes back at once, so its listeners are in place before the
   * endpoint can report it open; `answer` resolves with the endpoint's answer
   * for the station, or rejects (closing the connection) when the endpoint
   * refuses or does not answer.
   */
  join(
    peerId: string,
    sdp: string,
  ): { conn: EndpointConnection; answer: Promise<string> } {
    const sid = this.nextSid++;
    const conn = new EndpointConnection(
      peerId,
      sid,
      (s, frame) => this.sendData(s, frame),
      (s) => this.sendControl({ type: "close", sid: s }),
    );
    if (!this.up || !this.socket) {
      conn.markClosed();
      return {
        conn,
        answer: Promise.reject(new Error("the endpoint is not running")),
      };
    }
    this.links.set(sid, conn);
    conn.on("close", () => this.links.delete(sid));
    const answer = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sid);
        conn.close();
        reject(new Error("the endpoint did not answer"));
      }, ANSWER_TIMEOUT_MS);
      this.pending.set(sid, { conn, resolve, reject, timer });
    });
    this.sendControl({ type: "offer", sid, peerId, sdp });
    return { conn, answer };
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") {
        this.control(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) this.data(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lost();
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const delay = Math.min(1_000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Every station on the socket is gone with it: the endpoint drops them when its main screen leaves. */
  private lost(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("the endpoint went away"));
    }
    this.pending.clear();
    for (const conn of [...this.links.values()]) conn.markClosed();
    this.links.clear();
    this.setUp(false);
  }

  private setUp(up: boolean): void {
    if (this.up === up) return;
    this.up = up;
    if (up) {
      this.attempt = 0;
      logger.info("[EndpointStations] the station endpoint is up");
    }
    this.events.emit("available", up);
  }

  private control(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const field = (key: keyof ControlFrame): unknown =>
      Reflect.get(parsed, key);
    const f: ControlFrame = {
      type: field("type"),
      sid: field("sid"),
      sdp: field("sdp"),
      reason: field("reason"),
      path: field("path"),
      port: field("port"),
      publicIp: field("publicIp"),
    };
    const sid = typeof f.sid === "number" ? f.sid : -1;
    switch (f.type) {
      case "status":
        this.current = {
          port: typeof f.port === "number" ? f.port : 0,
          publicIp:
            typeof f.publicIp === "string" && f.publicIp ? f.publicIp : null,
        };
        this.setUp(true);
        return;
      case "answer": {
        const p = this.pending.get(sid);
        if (!p || typeof f.sdp !== "string") return;
        this.pending.delete(sid);
        clearTimeout(p.timer);
        p.resolve(f.sdp);
        return;
      }
      case "open":
        this.links
          .get(sid)
          ?.markOpen(f.path === "lan" || f.path === "internet" ? f.path : null);
        return;
      case "close": {
        const p = this.pending.get(sid);
        if (p) {
          this.pending.delete(sid);
          clearTimeout(p.timer);
          p.reject(
            new Error(
              `the endpoint refused the station: ${String(f.reason ?? "")}`,
            ),
          );
        }
        this.links.get(sid)?.markClosed();
        return;
      }
    }
  }

  private data(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 4) return;
    const sid = new DataView(buffer).getUint32(0);
    this.links.get(sid)?.receive(new Uint8Array(buffer, 4));
  }

  private sendControl(frame: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private sendData(sid: number, frame: Uint8Array): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(4 + frame.byteLength);
    new DataView(out.buffer).setUint32(0, sid);
    out.set(frame, 4);
    socket.send(out);
  }
}
