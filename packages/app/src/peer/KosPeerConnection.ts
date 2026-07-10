import type { KosConnection, KosConnectionParams } from "@ksp-gonogo/core";
import type { PeerClientService } from "./PeerClientService";

type EventType = "open" | "message" | "close" | "error";
// biome-ignore lint/suspicious/noExplicitAny: impl signature must accept all overload shapes (typed per-event)
type AnyListener = (...args: any[]) => void;

export class KosPeerConnection implements KosConnection {
  readyState: number = WebSocket.CONNECTING;

  private listeners = new Map<EventType, Set<AnyListener>>();
  private unsubs: (() => void)[] = [];
  private closed = false; // permanent (user/host-initiated) closure
  private hasConnectedOnce = false;

  constructor(
    private sessionId: string,
    private client: PeerClientService,
    private params: Omit<KosConnectionParams, "sessionId">,
  ) {
    this.unsubs.push(
      client.onKosOpened((sid) => {
        if (sid !== this.sessionId || this.closed) return;
        if (this.readyState !== WebSocket.CONNECTING) return; // dedupe
        this.readyState = WebSocket.OPEN;
        this.emit("open");
      }),
      client.onKosData((sid, data) => {
        if (sid !== this.sessionId || this.closed) return;
        this.emit("message", { data });
      }),
      client.onKosClose((sid) => {
        if (sid !== this.sessionId || this.closed) return;
        // Host explicitly closed this session (PTY exited) — permanent.
        this.closed = true;
        this.readyState = WebSocket.CLOSED;
        this.emit("close");
        this.cleanup();
      }),
      client.onConnectionStatus((status) => {
        if (this.closed) return;
        if (status === "connected") {
          // The first "connected" after construction is the initial peer open —
          // our constructor already sent kos-open, so skip re-sending. Every
          // subsequent "connected" is a reconnect and warrants a fresh kos-open.
          if (this.hasConnectedOnce) {
            this.readyState = WebSocket.CONNECTING;
            this.client.sendKosOpen(this.sessionId, this.params);
          }
          this.hasConnectedOnce = true;
        } else if (this.readyState === WebSocket.OPEN) {
          // Peer dropped out while we had a live session — let the UI see a
          // close event so it can surface the transient disconnect. The state
          // machine stays alive; we'll re-send kos-open on the next "connected".
          this.readyState = WebSocket.CONNECTING;
          this.emit("close");
        }
      }),
    );

    client.sendKosOpen(sessionId, params);
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string }) => void,
  ): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: EventType, listener: AnyListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  send(data: string) {
    if (this.readyState !== WebSocket.OPEN) return;
    this.client.sendKosData(this.sessionId, data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    // Always notify the host — even mid-handshake (CONNECTING). The host's
    // kos-close handler no-ops on unknown sessionIds, so this is safe, and it
    // prevents a pending proxy session from outliving the station-side mount
    // that requested it.
    this.client.sendKosClose(this.sessionId);
    this.readyState = WebSocket.CLOSED;
    this.cleanup();
  }

  private emit(type: EventType, e?: { data: string }) {
    this.listeners.get(type)?.forEach((cb) => {
      cb(e);
    });
  }

  private cleanup() {
    this.unsubs.forEach((u) => {
      u();
    });
    this.unsubs = [];
  }
}
