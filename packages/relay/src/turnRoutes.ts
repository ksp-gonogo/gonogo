import type { FastifyInstance } from "fastify";
import type { CoturnHandle } from "./coturnManager.js";

/** Minimal ICE-server shape: matches the `/ice-config` response and peerjs's `config.iceServers`. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnRoutesOptions {
  /** The live coturn handle, or null when none was started. */
  getCoturn: () => CoturnHandle | null;
  /** Why the relay server is not up yet but will be retried, or null. While set, the relay itself is healthy. */
  getPendingReason?: () => string | null;
  /** True when this relay is meant to run coturn (`SKIP_COTURN` unset), so a missing or dead one is a fault. */
  turnExpected: boolean;
}

/**
 * Build the ICE-server list advertising the relay's coturn over both UDP and
 * TCP. Without an explicit `?transport=` hint browsers gather only a UDP relay
 * candidate, which strands clients on UDP-restrictive networks. coturn listens
 * on both, so the transport list is purely a hint.
 */
export function iceServersFor(
  handle: CoturnHandle,
  hostOverride?: string,
): IceServer[] {
  const turnHost = `${hostOverride ?? handle.externalIp}:${handle.port}`;
  return [
    {
      urls: [
        `turn:${turnHost}?transport=udp`,
        `turn:${turnHost}?transport=tcp`,
      ],
      username: handle.username,
      credential: handle.credential,
    },
  ];
}

/**
 * Mount `/health` and `/ice-config`. `/ice-config` answers 503 with a reason
 * whenever coturn is not running, so a caller never receives credentials for
 * a dead server. `/health` answers 503 when coturn is expected but dead or
 * missing; while the relay server is only waiting to be retried (no public IP yet) the
 * relay is healthy, so it answers 200 with `turn: null` and the reason, and a
 * LAN that needs no relay server is not shown a failure.
 */
export function registerTurnRoutes(
  fastify: FastifyInstance,
  { getCoturn, getPendingReason, turnExpected }: TurnRoutesOptions,
): void {
  const live = (): CoturnHandle | null => {
    const handle = getCoturn();
    return handle?.running() ? handle : null;
  };

  fastify.get("/health", async (_req, reply) => {
    const handle = live();
    if (handle) {
      return {
        status: "ok",
        turn: { externalIp: handle.externalIp, port: handle.port },
      };
    }
    const pending = getPendingReason?.() ?? null;
    if (pending) return { status: "ok", turn: null, turnUnavailable: pending };
    if (turnExpected) {
      return reply.status(503).send({ status: "turn-down", turn: null });
    }
    return { status: "ok", turn: null };
  });

  /**
   * ICE configuration the main screen uses when constructing its PeerJS Peer.
   * The credentials live only in this process's memory and rotate on every
   * restart, so a client with stale credentials re-fetches this endpoint.
   * Stations do not fetch it: they pair against the host's relay candidates
   * over the broker's signalling channel.
   */
  fastify.get("/ice-config", async (_req, reply) => {
    const handle = live();
    if (!handle) {
      return reply.status(503).send({
        error: "TURN not available",
        reason: getPendingReason?.() ?? "coturn is not running",
      });
    }
    return { iceServers: iceServersFor(handle) };
  });
}
