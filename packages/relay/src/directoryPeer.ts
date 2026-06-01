// ──────────────────────────────────────────────────────────────────────
// SUPERSEDED by the stable-host-id model (the host now claims a
// deterministic `gonogo-host-<code>` broker peer id and stations derive the
// same id from the share code — no directory resolve hop). This directory
// peer is unused by the app and slated for removal in a follow-up; left in
// place for now so the relay keeps building and the POST /host registry
// (diagnostics-only) is undisturbed.
//
// Broker-side host directory.
//
// The station and the host's relay only ever share ONE rendezvous: the
// PeerJS broker (peerjs.com by default). The host POSTs its current peer
// id to its LOCAL relay over HTTP — that works because they're on the same
// machine — but a station on another device can't reach that relay over
// HTTP (its `localhost:3002` is its own box, with no relay on it). So we
// expose the registry *through the broker*: the relay joins the same
// broker as a peer with a stable id derived from the host's share code
// (`gonogo-dir-<shareCode>`), and a station opens a DataConnection to that
// id to resolve the code to the host's current peer id.
//
// The relay can hold a stable directory id because, unlike the main
// screen, it never reloads. One relay serves one host, so normally one
// directory peer — but a `Map<shareCode, handle>` keeps it correct if a
// relay ever sees more than one code.
//
// wrtc + peerjs are kept entirely inside this module (the only place in
// the relay that needs WebRTC). `index.ts` sees only the small
// `DirectoryPeerService` interface below.
// ──────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import type { HostRegistry } from "./hostRegistry.js";
// Side-effect import: installs the WebRTC globals (RTCPeerConnection etc.)
// that peerjs sniffs at its own module-load time. MUST run before the
// `require("peerjs")` below, which ES import hoisting guarantees (imports
// run top-to-bottom before any statement in this module body).
import "./wrtcGlobals.js";

// peerjs is a parcel-bundled CJS module. Under Node ESM only `default` is
// re-exported as a named binding (parcel uses Object.defineProperty, which
// cjs-module-lexer can't statically detect), so load via createRequire to
// grab the real Peer constructor directly.
const require = createRequire(import.meta.url);
const { Peer } = require("peerjs") as {
  Peer: new (
    id: string,
    options: Record<string, unknown>,
  ) => DirectoryPeerInstance;
};

// Minimal structural typing for the bits of the peerjs Peer / DataConnection
// this module touches — avoids a type-only `import "peerjs"` (which drags the
// browser-typed surface into the relay's tsconfig).
interface DirectoryDataConnection {
  on(event: "open" | "close", cb: () => void): void;
  on(event: "data", cb: (raw: unknown) => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  send(msg: unknown): void;
  close(): void;
}
interface DirectoryPeerInstance {
  on(event: "open", cb: (id: string) => void): void;
  on(event: "connection", cb: (conn: DirectoryDataConnection) => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  destroy(): void;
}

/** Prefix for the directory peer's broker id. Mirrors the app's
 *  `directoryProtocol.ts` (the relay can't import from `@gonogo/app`). The
 *  full id is `${DIRECTORY_PEER_PREFIX}${shareCode}`; prefixed so it can't
 *  collide with a host's own 4-char peer id on the shared broker keyspace. */
export const DIRECTORY_PEER_PREFIX = "gonogo-dir-";

/** Station → directory request. */
interface ResolveRequest {
  type: "resolve";
}
/** Directory → station response. */
type ResolveResponse = { type: "host"; peerId: string } | { type: "not-found" };

/**
 * Pure resolve handler — the only directory logic worth unit-testing. Maps
 * an incoming request to the reply, reading the live host peer id out of
 * the registry. Kept transport-free so a `fastify.inject`-style test can
 * drive it against a real `HostRegistry` (the broker/Peer wiring is covered
 * by the Playwright suite, which already boots a broker + the relay).
 */
export function resolveReply(
  registry: HostRegistry,
  shareCode: string,
  msg: unknown,
): ResolveResponse {
  if ((msg as ResolveRequest | undefined)?.type !== "resolve") {
    return { type: "not-found" };
  }
  const peerId = registry.resolve(shareCode);
  return peerId ? { type: "host", peerId } : { type: "not-found" };
}

/** Broker connection options for the directory peer. Mirrors the app's
 *  `peerOptions.ts` env names (`PEER_*`) and defaults to the same public
 *  broker + `key: "gonogo"` namespace the app defaults to. */
export interface DirectoryPeerOptions {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
}

/** Minimal ICE-server shape — matches the `/ice-config` response and
 *  peerjs's `config.iceServers`. Defined locally so the relay's tsconfig
 *  doesn't have to pull in DOM's `RTCIceServer`. */
export interface DirectoryIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Read broker options from the environment, defaulting to the same public
 * broker (`0.peerjs.com`, key `gonogo`) the app's `peerOptions.ts`
 * defaults to. The Playwright config passes `PEER_HOST/PORT/PATH/SECURE`
 * to the relay; `PEER_KEY` mirrors the app's hardcoded `"gonogo"`.
 */
export function directoryPeerOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DirectoryPeerOptions {
  const opts: DirectoryPeerOptions = { key: env.PEER_KEY ?? "gonogo" };
  if (env.PEER_HOST) opts.host = env.PEER_HOST;
  if (env.PEER_PORT) {
    const n = Number.parseInt(env.PEER_PORT, 10);
    if (Number.isFinite(n)) opts.port = n;
  }
  if (env.PEER_PATH) opts.path = env.PEER_PATH;
  if (env.PEER_SECURE !== undefined) {
    // Accept "0"/"false" as false, anything else truthy as true.
    opts.secure = !(env.PEER_SECURE === "0" || env.PEER_SECURE === "false");
  }
  return opts;
}

interface DirectoryHandle {
  shareCode: string;
  peer: DirectoryPeerInstance;
}

export interface DirectoryLogger {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}

/**
 * Manages directory peers — one per share-code seen via `POST /host`. The
 * relay calls `ensure(shareCode)` from the host-registry register hook;
 * the first call for a code spins up a `gonogo-dir-<code>` peer, repeats
 * are no-ops (idempotent), so heartbeat POSTs don't churn peers.
 */
export class DirectoryPeerService {
  private readonly handles = new Map<string, DirectoryHandle>();

  constructor(
    private readonly registry: HostRegistry,
    private readonly options: DirectoryPeerOptions,
    private readonly logger: DirectoryLogger,
    /**
     * Supplies the TURN/STUN servers the directory peer should relay its
     * DataConnections through — the relay's own coturn, the same servers
     * `/ice-config` hands the host browser. Evaluated lazily at peer-creation
     * time (coturn has started by then). Returns `undefined` when coturn is
     * unavailable, in which case the peer falls back to host candidates only
     * (reachable on the same machine / LAN-routable host, but not from a
     * station on another device behind NAT).
     */
    private readonly getIceServers?: () => DirectoryIceServer[] | undefined,
  ) {}

  /** Spin up (or keep) the directory peer for a share-code. Idempotent. */
  ensure(shareCode: string): void {
    if (this.handles.has(shareCode)) return;
    const id = `${DIRECTORY_PEER_PREFIX}${shareCode}`;
    let peer: DirectoryPeerInstance;
    // Relay this peer's DataConnections through coturn (when available) so a
    // station on another device gets a reachable relay candidate. Without it
    // the peer only offers container-internal host candidates, which nothing
    // off the relay's box can route to.
    const peerOptions: Record<string, unknown> = { ...this.options };
    const iceServers = this.getIceServers?.();
    if (iceServers && iceServers.length > 0) {
      peerOptions.config = { iceServers };
    }
    try {
      peer = new Peer(id, peerOptions);
    } catch (err) {
      this.logger.error(`[directory] failed to construct peer ${id}`, err);
      return;
    }
    const handle: DirectoryHandle = { shareCode, peer };
    this.handles.set(shareCode, handle);

    peer.on("open", (openId) => {
      this.logger.info(`[directory] open id=${openId}`);
    });
    peer.on("connection", (conn) => {
      conn.on("data", (raw) => {
        const reply = resolveReply(this.registry, shareCode, raw);
        // Reply only — DON'T close here. Closing a WebRTC data channel
        // immediately after a send can tear it down before the buffered
        // message flushes, so the station would see `close` (→ direct-
        // connect fallback) instead of the reply. The lookup is still
        // one-shot: the station closes the connection itself the moment it
        // receives the reply (see resolveHostPeerId → finish()), which
        // surfaces here as the `close` event below.
        conn.send(reply);
      });
      conn.on("close", () => {
        // Station closed after receiving its reply (or gave up) — nothing
        // to clean up beyond what peerjs does; this is just the expected
        // end of a one-shot lookup.
      });
      conn.on("error", (err) => {
        this.logger.error("[directory] connection error", err);
      });
    });
    peer.on("error", (err) => {
      // `unavailable-id` means another process already holds this directory
      // id on the broker (e.g. a previous relay instance the broker hasn't
      // timed out yet). Drop the handle so a later heartbeat can retry.
      this.logger.error(`[directory] peer ${id} error`, err);
      const type = (err as { type?: string })?.type;
      if (type === "unavailable-id") {
        this.handles.delete(shareCode);
        try {
          peer.destroy();
        } catch {
          /* already destroyed */
        }
      }
    });
  }

  /** Tear down every directory peer. Called on relay shutdown. */
  stop(): void {
    for (const { peer } of this.handles.values()) {
      try {
        peer.destroy();
      } catch {
        /* already destroyed */
      }
    }
    this.handles.clear();
  }
}
