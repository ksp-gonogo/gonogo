import { logger } from "@ksp-gonogo/logger";
import { FramedLink } from "./framedLink";
import { TypedListeners } from "./typedListeners";

/** Where a station on the endpoint is: the home network or the internet. */
export type EndpointPath = "lan" | "internet";

/**
 * One station joined through the endpoint, as the main screen sees it, so a
 * station is served the same way whichever path it joined by.
 */
export class EndpointConnection extends FramedLink {
  /** Set when the endpoint reports the station's data channel open. */
  path: EndpointPath | null = null;
  /** The bytes waiting in the endpoint to go out to the station, as it last reported, or null until the station opens. The endpoint reports only changes, from nothing queued. */
  queuedBytes: number | null = null;

  constructor(
    /** The station's broker peer id, which approvals and every per-station record are keyed by. */
    peer: string,
    readonly sid: number,
    private readonly sendTo: (sid: number, frame: Uint8Array) => void,
    private readonly sendClose: (sid: number) => void,
  ) {
    super(peer);
  }

  /** The endpoint always lets what the station has been sent drain before it closes. */
  close(_options?: { flush?: boolean }): void {
    if (this.isEnded) return;
    this.sendClose(this.sid);
    this.finished();
  }

  protected sendFrame(frame: Uint8Array<ArrayBuffer>): void {
    this.sendTo(this.sid, frame);
  }

  /** @internal */
  markOpen(path: EndpointPath | null): void {
    if (this.isEnded || this.open) return;
    this.path = path;
    this.queuedBytes = 0;
    this.opened();
  }

  /** @internal */
  receive(frame: Uint8Array): void {
    this.received(frame);
  }

  /** @internal */
  markClosed(): void {
    this.finished();
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
  bid?: unknown;
  port?: unknown;
  publicIp?: unknown;
  sid?: unknown;
  sdp?: unknown;
  reason?: unknown;
  path?: unknown;
  bytes?: unknown;
}

interface PendingJoin {
  conn: EndpointConnection;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ANSWER_TIMEOUT_MS = 10_000;
const BRIDGE_TIMEOUT_MS = 20_000;

interface PendingBridge {
  upstream: (offer: string) => Promise<string>;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
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
  private nextBid = 1;
  private readonly bridges = new Map<number, PendingBridge>();
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

  /**
   * Bridge a media connection a station on the endpoint is opening, such as
   * a camera feed, to a server only this network can reach. `offer` is the
   * station's offer; the endpoint makes its own offer for the server, which
   * `upstream` negotiates with that server and answers. Resolves with the
   * endpoint's answer to send the station.
   */
  bridge(
    conn: EndpointConnection,
    offer: string,
    upstream: (offer: string) => Promise<string>,
  ): Promise<string> {
    if (!this.up || !conn.open) {
      return Promise.reject(new Error("the station is not on the endpoint"));
    }
    const bid = this.nextBid++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.bridges.delete(bid);
        this.sendControl({ type: "bridge-close", bid });
        reject(new Error("the endpoint did not bridge the connection in time"));
      }, BRIDGE_TIMEOUT_MS);
      this.bridges.set(bid, { upstream, resolve, reject, timer });
      this.sendControl({ type: "bridge", sid: conn.sid, bid, sdp: offer });
    });
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
    for (const b of this.bridges.values()) {
      clearTimeout(b.timer);
      b.reject(new Error("the endpoint went away"));
    }
    this.bridges.clear();
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
      bid: field("bid"),
      sdp: field("sdp"),
      reason: field("reason"),
      path: field("path"),
      bytes: field("bytes"),
      port: field("port"),
      publicIp: field("publicIp"),
    };
    const sid = typeof f.sid === "number" ? f.sid : -1;
    const bid = typeof f.bid === "number" ? f.bid : -1;
    switch (f.type) {
      case "bridge-offer": {
        const b = this.bridges.get(bid);
        if (!b || typeof f.sdp !== "string") return;
        b.upstream(f.sdp).then(
          (answer) =>
            this.sendControl({ type: "bridge-answer", bid, sdp: answer }),
          (err: unknown) => {
            this.endBridge(
              bid,
              err instanceof Error ? err : new Error(String(err)),
            );
            this.sendControl({ type: "bridge-close", bid });
          },
        );
        return;
      }
      case "bridge-ready": {
        const b = this.bridges.get(bid);
        if (!b || typeof f.sdp !== "string") return;
        this.bridges.delete(bid);
        clearTimeout(b.timer);
        b.resolve(f.sdp);
        return;
      }
      case "bridge-close":
        this.endBridge(
          bid,
          new Error(
            `the endpoint closed the bridge: ${String(f.reason ?? "")}`,
          ),
        );
        return;
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
      case "queued": {
        const link = this.links.get(sid);
        if (link && typeof f.bytes === "number") link.queuedBytes = f.bytes;
        return;
      }
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

  private endBridge(bid: number, err: Error): void {
    const b = this.bridges.get(bid);
    if (!b) return;
    this.bridges.delete(bid);
    clearTimeout(b.timer);
    b.reject(err);
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
