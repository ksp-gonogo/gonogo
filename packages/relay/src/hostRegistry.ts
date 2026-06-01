import type { FastifyInstance } from "fastify";

/**
 * In-memory share-code → peer-id registry.
 *
 * Decouples the stable, operator-facing **share-code** (which never
 * changes across host refreshes) from the **ephemeral PeerJS peer id**
 * (which the public broker forces the host to rotate on any navigation —
 * see `local_docs/relay-host-discovery.md`).
 *
 * - The host `POST /host { shareCode, peerId }` on every PeerJS `open`
 *   and again on a periodic heartbeat.
 * - The station resolves the current peer id over the PeerJS broker via
 *   the relay's directory peer (`gonogo-dir-<shareCode>`), which reads
 *   this registry in-process (`registry.resolve(shareCode)`). It
 *   re-resolves on every reconnect so it auto-follows the host's rotation.
 *   (The old cross-machine-broken HTTP `GET /host/:shareCode` lookup was
 *   removed in favour of the broker path — see `directoryPeer.ts`.)
 *
 * In-memory only. A relay restart just means hosts re-register on their
 * next heartbeat. Single-instance assumption — a shared registry across
 * relay instances is out of scope (the same assumption coturn makes).
 */

/** How long a registration stays valid without a refresh. Comfortably
 *  longer than the host's ~30s heartbeat so one missed beat doesn't
 *  strand a station mid-resolve. */
export const HOST_TTL_MS = 90_000;

interface HostEntry {
  peerId: string;
  expiresAt: number;
}

export class HostRegistry {
  private readonly entries = new Map<string, HostEntry>();

  constructor(private readonly ttlMs: number = HOST_TTL_MS) {}

  /** Register (or refresh) the peer id a share-code currently maps to. */
  register(shareCode: string, peerId: string, now: number = Date.now()): void {
    this.entries.set(shareCode, { peerId, expiresAt: now + this.ttlMs });
  }

  /**
   * Resolve a share-code to its current peer id, or `null` if unknown or
   * expired. Sweeps the looked-up entry lazily so a stale record can't
   * resolve once its TTL has passed.
   */
  resolve(shareCode: string, now: number = Date.now()): string | null {
    const entry = this.entries.get(shareCode);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(shareCode);
      return null;
    }
    return entry.peerId;
  }

  /** Drop every expired entry. Called on a timer to bound memory in the
   *  steady state (lazy GET-time sweep only touches looked-up codes). */
  sweep(now: number = Date.now()): void {
    for (const [code, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(code);
    }
  }

  /** Live entry count — used by tests to assert TTL sweeps. */
  get size(): number {
    return this.entries.size;
  }
}

interface RegisterHostBody {
  shareCode?: unknown;
  peerId?: unknown;
}

/** Options for `registerHostRoutes`. */
export interface RegisterHostRoutesOptions {
  /** Backing registry. Defaults to a fresh one; tests pass their own to
   *  control the TTL or inspect entries. */
  registry?: HostRegistry;
  /** Called after each accepted `POST /host`, with the registered
   *  share-code + peer id. The relay uses this to (lazily) bring up the
   *  broker-side directory peer for the code — see `directoryPeer.ts`.
   *  Kept as a callback so this module stays peerjs/wrtc-free. */
  onRegister?: (shareCode: string, peerId: string) => void;
}

/**
 * Mount the host-discovery route onto a Fastify instance. CORS is
 * inherited from the global `@fastify/cors` registration the relay
 * already applies (same as `/ice-config`) — no per-route allowlist.
 *
 * Only `POST /host` is exposed: stations no longer GET the registry over
 * HTTP (that path was broken cross-machine — the relay is local to the
 * host). They resolve over the broker via the directory peer instead,
 * which reads this registry in-process.
 *
 * Returns the backing registry so the caller can wire a periodic sweep
 * timer (and tests can inspect it).
 */
export function registerHostRoutes(
  fastify: FastifyInstance,
  options: RegisterHostRoutesOptions = {},
): HostRegistry {
  const registry = options.registry ?? new HostRegistry();
  fastify.post("/host", async (req, reply) => {
    const body = (req.body ?? {}) as RegisterHostBody;
    const shareCode =
      typeof body.shareCode === "string" ? body.shareCode.trim() : "";
    const peerId = typeof body.peerId === "string" ? body.peerId.trim() : "";
    if (!shareCode || !peerId) {
      return reply
        .status(400)
        .send({ error: "shareCode and peerId are required" });
    }
    registry.register(shareCode, peerId);
    options.onRegister?.(shareCode, peerId);
    return { ok: true };
  });

  return registry;
}
