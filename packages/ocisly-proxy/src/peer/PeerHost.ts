import { createRequire } from "node:module";
import wrtc from "@roamhq/wrtc";
import type {
  DataConnection,
  MediaConnection,
  Peer as PeerClass,
  PeerOptions,
} from "peerjs";

// peerjs is a parcel-bundled CJS module. Under Node ESM, only `default` is
// re-exported as a named binding (parcel uses Object.defineProperty, which
// cjs-module-lexer can't statically detect). Load via createRequire to grab
// the real Peer constructor directly.
const require = createRequire(import.meta.url);
const { Peer } = require("peerjs") as { Peer: typeof PeerClass };

const WrtcMediaStream = wrtc.MediaStream;

import type { CameraMetadata, CameraPoller } from "../grpc/cameraPoller.js";
import type { OcislyClient } from "../grpc/OcislyClient.js";
import { BUILD_TIME, VERSION } from "../version.js";
import type { PeerIn, PeerOut } from "./controlProtocol.js";

export interface PeerHostOptions {
  peerId: string;
  client: OcislyClient;
  poller: CameraPoller;
  /**
   * ICE servers (STUN/TURN). Without a TURN entry here, podman-containerised
   * proxies can't complete WebRTC ICE to a browser peer because the
   * container's host candidates aren't routable from the host. See
   * docker-compose.yml `coturn` service + TURN_URL env.
   */
  iceServers?: RTCIceServer[];
  /** Logger — optional, defaults to console. */
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  /** Override broker. Defaults to the public peerjs.com broker, matching the app. */
  peerOptions?: Partial<PeerOptions>;
}

interface PeerSession {
  conn: DataConnection;
  subscriptions: Set<string>;
  calls: Map<string, MediaConnection>;
}

/**
 * One PeerJS host that accepts:
 *   • data connections — control channel (listCameras / subscribe / unsubscribe)
 *   • media calls      — answered with the camera's shared MediaStreamTrack
 */
export class PeerHost {
  private peer: InstanceType<typeof PeerClass> | null = null;
  private sessions = new Map<string, PeerSession>();
  private readonly logger: NonNullable<PeerHostOptions["logger"]>;

  constructor(private readonly opts: PeerHostOptions) {
    this.logger = opts.logger ?? {
      info: (msg, ...args) => console.log(msg, ...args),
      error: (msg, ...args) => console.error(msg, ...args),
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peerOptions: Partial<PeerOptions> = {
        ...(this.opts.peerOptions ?? {}),
      };
      if (this.opts.iceServers && this.opts.iceServers.length > 0) {
        peerOptions.config = {
          ...(peerOptions.config ?? {}),
          iceServers: [
            ...(peerOptions.config?.iceServers ?? []),
            ...this.opts.iceServers,
          ],
        };
      }
      const peer = new Peer(this.opts.peerId, peerOptions);
      this.peer = peer;

      peer.on("open", (id) => {
        this.logger.info(`[ocisly-peer] open id=${id}`);
        resolve();
      });
      peer.on("error", (err) => {
        this.logger.error("[ocisly-peer] peer error", err);
        // Only reject if we haven't opened yet; otherwise surface the error and keep running.
        if (!peer.open) reject(err);
      });
      peer.on("connection", (conn) => this.handleConnection(conn));
      // Ignore inbound calls — the proxy initiates all media calls from its
      // side after a client subscribes via the control data channel.
      peer.on("call", (call) => {
        this.logger.info(
          `[ocisly-peer] ignoring inbound call from ${call.peer} — proxy initiates calls`,
        );
        call.close();
      });
    });
  }

  stop(): void {
    for (const session of this.sessions.values()) {
      this.closeSession(session);
    }
    this.sessions.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  /**
   * Fan camera metadata out to every session currently subscribed to that
   * camera. Cheap to call per frame but index.ts throttles upstream.
   */
  broadcastMetadata(meta: CameraMetadata): void {
    for (const session of this.sessions.values()) {
      if (session.subscriptions.has(meta.cameraId)) {
        this.send(session.conn, { type: "metadata", metadata: meta });
      }
    }
  }

  // ---------------------------------------------------------------------------

  private handleConnection(conn: DataConnection): void {
    this.logger.info(`[ocisly-peer] incoming connection from ${conn.peer}`);
    const session: PeerSession = {
      conn,
      subscriptions: new Set(),
      calls: new Map(),
    };

    conn.on("open", () => {
      this.sessions.set(conn.peer, session);
      this.send(conn, {
        type: "hello",
        version: VERSION,
        buildTime: BUILD_TIME,
      });
    });

    conn.on("data", (raw) => {
      this.handleMessage(session, raw as PeerIn);
    });

    conn.on("close", () => {
      this.closeSession(session);
      this.sessions.delete(conn.peer);
      this.logger.info(`[ocisly-peer] disconnected ${conn.peer}`);
    });

    conn.on("error", (err) => {
      this.logger.error(`[ocisly-peer] data conn error ${conn.peer}`, err);
    });
  }

  private async handleMessage(
    session: PeerSession,
    msg: PeerIn,
  ): Promise<void> {
    try {
      if (msg.type === "listCameras") {
        const cameras = await this.opts.client.getActiveCameraIds();
        this.send(session.conn, { type: "cameras", cameras });
        return;
      }
      if (msg.type === "subscribe") {
        if (session.subscriptions.has(msg.cameraId)) {
          // Idempotent — already subscribed on this connection.
          this.send(session.conn, {
            type: "subscribed",
            cameraId: msg.cameraId,
          });
          return;
        }
        const source = this.opts.poller.subscribe(msg.cameraId);
        session.subscriptions.add(msg.cameraId);
        this.initiateMediaCall(session, msg.cameraId, source.track);
        this.send(session.conn, {
          type: "subscribed",
          cameraId: msg.cameraId,
        });
        return;
      }
      if (msg.type === "unsubscribe") {
        if (session.subscriptions.delete(msg.cameraId)) {
          this.opts.poller.release(msg.cameraId);
          // Close any in-flight media call for this camera.
          const call = session.calls.get(msg.cameraId);
          if (call) {
            call.close();
            session.calls.delete(msg.cameraId);
          }
        }
        this.send(session.conn, {
          type: "unsubscribed",
          cameraId: msg.cameraId,
        });
        return;
      }
      this.send(session.conn, {
        type: "error",
        message: `unknown message type: ${(msg as { type: string }).type}`,
      });
    } catch (err) {
      this.logger.error("[ocisly-peer] message handler error", err);
      this.send(session.conn, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private initiateMediaCall(
    session: PeerSession,
    cameraId: string,
    track: unknown,
  ): void {
    if (!this.peer) return;
    const stream = new WrtcMediaStream([
      track as MediaStreamTrack,
    ]) as unknown as MediaStream;
    const call: MediaConnection = this.peer.call(session.conn.peer, stream, {
      metadata: { cameraId },
    });
    session.calls.set(cameraId, call);
    this.logger.info(
      `[ocisly-peer] calling ${session.conn.peer} for camera ${cameraId}`,
    );
    call.on("close", () => {
      session.calls.delete(cameraId);
    });
    call.on("error", (err) => {
      this.logger.error(
        `[ocisly-peer] call error ${session.conn.peer}/${cameraId}`,
        err,
      );
    });
  }

  private send(conn: DataConnection, msg: PeerOut): void {
    try {
      conn.send(msg);
    } catch (err) {
      this.logger.error("[ocisly-peer] send failed", err);
    }
  }

  private closeSession(session: PeerSession): void {
    for (const call of session.calls.values()) {
      call.close();
    }
    session.calls.clear();
    for (const cameraId of session.subscriptions) {
      this.opts.poller.release(cameraId);
    }
    session.subscriptions.clear();
  }
}
