import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import { AxiomTransport, logger } from "@gonogo/logger";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { type CoturnHandle, startCoturn } from "./coturnManager.js";
import {
  DirectoryPeerService,
  directoryPeerOptionsFromEnv,
} from "./directoryPeer.js";
import { discoverPublicIp } from "./discoverPublicIp.js";
import {
  HOST_TTL_MS,
  HostRegistry,
  registerHostRoutes,
} from "./hostRegistry.js";
import { BUILD_TIME, VERSION } from "./version.js";

const config = loadConfig();

// Ship logs to Axiom when an ingest token is present. Mirrors the
// browser wiring in packages/app/src/main.tsx — without AXIOM_TOKEN,
// the transport is silently skipped, so dev/test never reach Axiom
// unless an operator opts in via `.env`/`.env.local`.
if (process.env.AXIOM_TOKEN) {
  logger.addTransport(
    new AxiomTransport({
      token: process.env.AXIOM_TOKEN,
      dataset: process.env.AXIOM_DATASET ?? "gonogo",
      url: process.env.AXIOM_URL,
      orgId: process.env.AXIOM_ORG_ID,
      // Node has no `pagehide`; the SIGINT/SIGTERM shutdown path
      // calls `logger.flushTransports()` instead.
      flushOnPageHide: false,
    }),
  );
}

logger.info(`gonogo relay v${VERSION} (build ${BUILD_TIME})`);

const fastify = Fastify({ logger: true });

// Bridge fastify's pino output through @gonogo/logger so every line
// hitting stderr/stdout also reaches Axiom (when configured). Pino
// still writes to its own stream — this is purely additive.
function bridgeInfo(msg: string, extra?: Record<string, unknown>): void {
  fastify.log.info(extra ?? {}, msg);
  logger.info(msg, extra);
}
function bridgeError(
  msg: string,
  err?: unknown,
  extra?: Record<string, unknown>,
): void {
  fastify.log.error({ err, ...(extra ?? {}) }, msg);
  const e = err instanceof Error ? err : undefined;
  const ctx: Record<string, unknown> = { ...(extra ?? {}) };
  if (err !== undefined && !(err instanceof Error)) ctx.err = err;
  logger.error(msg, e, Object.keys(ctx).length > 0 ? ctx : undefined);
}

await fastify.register(cors, { origin: true });

// Bridge Fastify's per-request log line through @gonogo/logger so it
// reaches Axiom alongside the explicit `bridgeInfo` operational events.
// Without this, `podman logs gonogo-relay-1` shows incoming/completed
// pairs (level 30 pino output) but the remote dataset stays silent
// between relay events, which makes "did the host reach the relay
// before timing out?" debugging from afar impossible.
//
// Successful responses (<400) go in at info; >=400 ride the warn
// channel so a 4xx/5xx blip is queryable via `level == "warn"` without
// scraping every routine request line. Body / headers are deliberately
// excluded — log volume + leak surface from no benefit to the
// debug use case.
fastify.addHook("onResponse", async (req, reply) => {
  const status = reply.statusCode;
  const ctx = {
    method: req.method,
    url: req.url,
    statusCode: status,
    responseTimeMs: Math.round(reply.elapsedTime * 100) / 100,
  };
  const msg = `${req.method} ${req.url} → ${status} (${ctx.responseTimeMs}ms)`;
  if (status >= 400) logger.warn(msg, ctx);
  else logger.info(msg, ctx);
});

// ──────────────────────────────────────────────────────────────────────
// Discover the public IP coturn should advertise, then start coturn as a
// child process with a fresh per-restart secret. Fail-soft: if discovery
// or coturn spawn fails, the relay still answers /health and /version,
// but the /ice-config endpoint will report an unreachable TURN. The
// browser readiness probe surfaces that to operators.
// ──────────────────────────────────────────────────────────────────────

let coturnHandle: CoturnHandle | null = null;
if (config.skipCoturn) {
  bridgeInfo(
    "SKIP_COTURN set — relay will run without TURN (intended for localhost tests)",
  );
} else {
  try {
    const externalIp = await discoverPublicIp({
      override: config.turnExternalIp ?? undefined,
    });
    bridgeInfo(`relay public IP for TURN: ${externalIp}`);
    coturnHandle = startCoturn({
      externalIp,
      logger: {
        info: (msg, ...args) => bridgeInfo(msg, { args }),
        error: (msg, ...args) => bridgeError(msg, undefined, { args }),
      },
    });
  } catch (err) {
    bridgeError(
      "failed to discover public IP / start coturn — TURN unavailable until fixed",
      err,
    );
  }
}

// Stable id for this relay process's lifetime — used only to tag log
// entries so a single relay's lines are filterable in Axiom.
const relayId = randomUUID();
logger.setIdentity({ role: "relay", id: relayId, peerId: relayId });

fastify.get("/health", async () => ({
  status: "ok",
  turn: coturnHandle
    ? {
        externalIp: coturnHandle.externalIp,
        port: coturnHandle.port,
      }
    : null,
}));

fastify.get("/version", async () => ({
  version: VERSION,
  buildTime: BUILD_TIME,
}));

/**
 * ICE configuration the main screen should use when constructing its
 * PeerJS Peer. The relay's TURN credentials live only in this process's
 * memory and rotate on every restart, so any client with stale creds
 * needs to re-fetch this endpoint to recover. Stations don't fetch
 * this themselves — they pair against the host's relay candidates over
 * the broker's signalling channel, which is sufficient for one-side
 * TURN to work.
 */
fastify.get("/ice-config", async (_req, reply) => {
  if (!coturnHandle) {
    return reply.status(503).send({ error: "TURN not available" });
  }
  // Advertise BOTH UDP and TCP transports for the same TURN server.
  // Without an explicit `?transport=` hint, browsers only gather a
  // UDP TURN candidate, which silently strands clients on
  // UDP-restrictive networks (corporate firewalls, some cellular
  // carriers — exactly the case our self-hosted TURN exists to help).
  // coturn listens on both UDP/3478 and TCP/3478 by default, so this
  // is purely a hint to the browser; no relay-side change needed.
  // The router port-forward needs both protocols (the Add Station
  // modal's Port management table already lists "TCP & UDP" for 3478).
  const turnHost = `${coturnHandle.externalIp}:${coturnHandle.port}`;
  return {
    iceServers: [
      {
        urls: [
          `turn:${turnHost}?transport=udp`,
          `turn:${turnHost}?transport=tcp`,
        ],
        username: coturnHandle.username,
        credential: coturnHandle.credential,
      },
    ],
  };
});

// ──────────────────────────────────────────────────────────────────────
// Host-discovery registry: maps a stable operator-facing share-code to the
// host's current (ephemeral) PeerJS peer id. Hosts POST on every broker
// open + heartbeat. Stations resolve over the PeerJS broker via the
// directory peer (below), which reads this registry in-process — the old
// cross-machine-broken HTTP GET was removed. CORS is inherited from the
// global registration above.
// ──────────────────────────────────────────────────────────────────────

// The directory peer joins the same broker the app uses (env PEER_*,
// default 0.peerjs.com / key "gonogo") as `gonogo-dir-<shareCode>`, so a
// station on any machine can resolve a share-code to the host's current
// peer id — the broker is the only rendezvous they both reach. wrtc/peerjs
// live entirely inside directoryPeer.ts.
const hostRegistry = new HostRegistry();
const directoryPeers = new DirectoryPeerService(
  hostRegistry,
  directoryPeerOptionsFromEnv(),
  {
    info: (msg) => bridgeInfo(msg),
    error: (msg, err) => bridgeError(msg, err),
  },
);
registerHostRoutes(fastify, {
  registry: hostRegistry,
  // On every accepted host registration, ensure the broker-side directory
  // peer for that share-code exists. Idempotent — heartbeat POSTs don't
  // churn peers.
  onRegister: (shareCode) => directoryPeers.ensure(shareCode),
});
// Bound steady-state memory: lazy GET-time sweeps only touch looked-up
// codes, so a host that stops heartbeating without anyone resolving it
// would linger forever. Half the TTL is a comfortable cadence.
const hostSweepTimer = setInterval(() => {
  hostRegistry.sweep();
}, HOST_TTL_MS / 2);
// Don't let the sweep timer keep the process alive on its own.
hostSweepTimer.unref?.();

await fastify.listen({ port: config.port, host: "0.0.0.0" });
bridgeInfo(`relay listening on :${config.port}`);

const shutdown = async () => {
  bridgeInfo("shutting down");
  clearInterval(hostSweepTimer);
  directoryPeers.stop();
  await coturnHandle?.stop();
  await fastify.close();
  // Drain any buffered Axiom entries before the process exits.
  await logger.flushTransports();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
