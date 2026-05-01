import { logger } from "@gonogo/core";
import type { DataConnection } from "peerjs";
import type { PeerMessage } from "./protocol";

interface KosSession {
  ws: WebSocket;
  conn: DataConnection;
}

interface KosConfig {
  host?: string;
  port?: number;
  kosHost?: string;
  kosPort?: number;
}

export interface KosSessionManagerDeps {
  /** Pulls the host-side `kos` data source's config (proxy host/port + kOS host/port). */
  getKosConfig(): Promise<KosConfig | undefined>;
}

/**
 * Owns the kOS-terminal WebSocket↔DataConnection bridge on the host.
 * Each `kos-open` from a station spawns a WebSocket to the proxy; data
 * goes both ways through the matching `DataConnection`. A late close on
 * a replaced session is ignored to avoid a spurious `kos-close` to the
 * live replacement.
 */
export class KosSessionManager {
  private readonly sessions = new Map<string, KosSession>();

  constructor(private readonly deps: KosSessionManagerDeps) {}

  async handleOpen(
    msg: Extract<PeerMessage, { type: "kos-open" }>,
    conn: DataConnection,
  ): Promise<void> {
    // StrictMode fires effects twice — close any existing session with this id
    // before opening the replacement. Remove from map BEFORE closing so the
    // close-event handler doesn't echo kos-close back to the station.
    const existing = this.sessions.get(msg.sessionId);
    if (existing) {
      this.sessions.delete(msg.sessionId);
      existing.ws.close();
    }

    const kosConfig = await this.deps.getKosConfig();
    const proxyHost = kosConfig?.host ?? "localhost";
    const proxyPort = kosConfig?.port ?? 3001;
    // Always use the host's kos config for the actual kOS address — stations
    // don't have a real kos data source and would send localhost as a fallback.
    const kosHost = kosConfig?.kosHost ?? msg.kosHost;
    const kosPort = kosConfig?.kosPort ?? msg.kosPort;

    const url =
      `ws://${proxyHost}:${proxyPort}/kos` +
      `?host=${encodeURIComponent(kosHost)}&port=${kosPort}` +
      `&id=${msg.sessionId}&cols=${msg.cols}&rows=${msg.rows}`;

    logger.info(`[PeerHost] kos-open — session=${msg.sessionId} url=${url}`);

    const ws = new WebSocket(url);
    this.sessions.set(msg.sessionId, { ws, conn });

    ws.addEventListener("open", () => {
      conn.send({
        type: "kos-opened",
        sessionId: msg.sessionId,
      } satisfies PeerMessage);
    });

    ws.addEventListener("message", (e) => {
      const data = typeof e.data === "string" ? e.data : String(e.data);
      conn.send({
        type: "kos-data",
        sessionId: msg.sessionId,
        data,
      } satisfies PeerMessage);
    });

    ws.addEventListener("close", () => {
      // If this ws has already been replaced, ignore its late close.
      const current = this.sessions.get(msg.sessionId);
      if (current?.ws !== ws) return;
      this.sessions.delete(msg.sessionId);
      conn.send({
        type: "kos-close",
        sessionId: msg.sessionId,
      } satisfies PeerMessage);
    });

    ws.addEventListener("error", () => {
      // Ignore errors from a ws we've already replaced.
      const current = this.sessions.get(msg.sessionId);
      if (current?.ws !== ws) return;
      logger.error(`[PeerHost] kos ws error — session=${msg.sessionId}`);
    });
  }

  handleData(msg: Extract<PeerMessage, { type: "kos-data" }>): void {
    const session = this.sessions.get(msg.sessionId);
    if (session?.ws.readyState === WebSocket.OPEN) {
      session.ws.send(msg.data);
    }
  }

  async handleResize(
    msg: Extract<PeerMessage, { type: "kos-resize" }>,
  ): Promise<void> {
    const kosConfig = await this.deps.getKosConfig();
    const proxyHost = kosConfig?.host ?? "localhost";
    const proxyPort = kosConfig?.port ?? 3001;

    fetch(`http://${proxyHost}:${proxyPort}/kos/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.sessionId,
        cols: msg.cols,
        rows: msg.rows,
      }),
    }).catch(() => {});
  }

  handleClose(msg: Extract<PeerMessage, { type: "kos-close" }>): void {
    const session = this.sessions.get(msg.sessionId);
    if (!session) return;
    // Remove before closing so the WS close event doesn't echo kos-close back.
    this.sessions.delete(msg.sessionId);
    session.ws.close();
  }

  /** Tear down every session whose station-side `conn` matches `conn`. */
  closeAllForConn(conn: DataConnection): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.conn === conn) {
        this.sessions.delete(sessionId);
        session.ws.close();
        logger.info(
          `[PeerHost] kos session closed on peer disconnect — session=${sessionId}`,
        );
      }
    }
  }

  /** Terminate every active session — used on host shutdown. */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.ws.close();
    }
    this.sessions.clear();
  }
}
