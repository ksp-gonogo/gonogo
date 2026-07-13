import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import cors from "@fastify/cors";
import {
  AxiomConsentController,
  AxiomTransport,
  logger,
} from "@ksp-gonogo/logger";
import Fastify from "fastify";
import { registerAnalyticsConfigRoutes } from "./analyticsConfig.js";
import { registerBootstrapConfigRoutes } from "./bootstrapConfig.js";
import { loadConfig } from "./config.js";
import { type CoturnHandle, startCoturn } from "./coturnManager.js";
import { discoverPublicIp } from "./discoverPublicIp.js";
import {
  HOST_TTL_MS,
  HostRegistry,
  registerHostRoutes,
} from "./hostRegistry.js";
import { BUILD_TIME, VERSION } from "./version.js";

const config = loadConfig();

// Ship logs to Axiom only when the token is present AND the host has
// enabled analytics consent (relayed in via POST /analytics-config). The
// token is the credential; consent is the runtime gate. Default is
// DISABLED until the first POST — privacy-first. Console/pino output is
// unaffected. The controller installs/removes the transport as the host's
// consent changes; `analyticsConfig` drives it through `onChange` below.
const axiomConsent = new AxiomConsentController({
  logger,
  makeTransport: () =>
    process.env.AXIOM_TOKEN
      ? new AxiomTransport({
          token: process.env.AXIOM_TOKEN,
          dataset: process.env.AXIOM_DATASET ?? "gonogo",
          url: process.env.AXIOM_URL,
          orgId: process.env.AXIOM_ORG_ID,
          // Node has no `pagehide`; the SIGINT/SIGTERM shutdown path
          // calls `logger.flushTransports()` instead.
          flushOnPageHide: false,
        })
      : null,
});

logger.info(`gonogo relay v${VERSION} (build ${BUILD_TIME})`);

const fastify = Fastify({ logger: true });

// Bridge fastify's pino output through @ksp-gonogo/logger so every line
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

// Bridge Fastify's per-request log line through @ksp-gonogo/logger so it
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

/**
 * This process's primary non-internal IPv4 — the address coturn can actually
 * bind relay sockets to. In a container that's the bridge IP (e.g.
 * `10.89.x.x`); running natively it's the host's LAN IP. Used as the
 * `/private` half of coturn's external-ip mapping. `undefined` if none found.
 */
function primaryLocalIpv4(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return undefined;
}

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
    // The address coturn actually binds relay sockets on. When externalIp is
    // a NAT / published / host-LAN address (the container case — externalIp is
    // the host's LAN IP, this process sees only the container's 10.x), coturn
    // must bind the local interface and merely advertise externalIp. Pass our
    // own primary non-internal IPv4 as the `/private` half.
    const localIp = primaryLocalIpv4();
    bridgeInfo(
      `relay TURN advertise=${externalIp}${localIp && localIp !== externalIp ? ` bind=${localIp}` : ""}`,
    );
    coturnHandle = startCoturn({
      externalIp,
      // Only attach the private half when it differs — `X/X` is pointless,
      // and when externalIp is itself local (native runs) coturn binds it fine.
      localIp: localIp && localIp !== externalIp ? localIp : undefined,
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

// Build the ICE-server list advertising the relay's coturn over BOTH UDP
// and TCP. Without an explicit `?transport=` hint browsers gather only a
// UDP TURN candidate, which strands clients on UDP-restrictive networks
// (corporate firewalls, some cellular carriers — exactly the case our
// self-hosted TURN exists to help). coturn listens on both UDP/3478 and
// TCP/3478, so the transport list is purely a hint. Consumed by /ice-config
// (the host browser). The router port-forward needs both protocols (the Add
// Station modal's Port table lists "TCP & UDP" for 3478).
// Minimal ICE-server shape — matches the `/ice-config` response and peerjs's
// `config.iceServers`. Defined locally so the relay's tsconfig doesn't have to
// pull in DOM's `RTCIceServer`.
interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

function iceServersFor(
  handle: CoturnHandle,
  hostOverride?: string,
): IceServer[] {
  // `hostOverride` lets a caller on the relay's own box reach coturn over
  // loopback instead of the advertised external IP. coturn still maps the
  // allocated relay candidate to the external IP, so stations get a reachable
  // address either way.
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
  return { iceServers: iceServersFor(coturnHandle) };
});

// ──────────────────────────────────────────────────────────────────────
// Host-discovery registry: maps a stable operator-facing share-code to the
// host's current (ephemeral) PeerJS peer id. Hosts POST on every broker
// open + heartbeat. CORS is inherited from the global registration above.
//
// Diagnostics-only under the stable-host-id model: the host claims a
// deterministic `gonogo-host-<code>` broker peer id and stations derive that
// id from the share code directly, so no resolve hop is needed. The
// `POST /host` registry remains a useful "is this host currently online?"
// signal but nothing routes through it.
// ──────────────────────────────────────────────────────────────────────
const hostRegistry = new HostRegistry();
registerHostRoutes(fastify, { registry: hostRegistry });

// Analytics-config broker: the host POSTs its consent here, the relay
// exposes it (GET + SSE) for any service that wants to gate on it, and gates
// its OWN Axiom sink on it via the onChange callback.
registerAnalyticsConfigRoutes(fastify, {
  onChange: (enabled) => {
    axiomConsent.apply(enabled);
    bridgeInfo(`analytics consent ${enabled ? "enabled" : "disabled"}`);
  },
});

// First-run bootstrap: republish the bundle's KSP_HOST so the SPA can seed
// its data-source defaults. Unset outside the bundle → { kspHost: null }.
registerBootstrapConfigRoutes(fastify, { kspHost: process.env.KSP_HOST });
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
  await coturnHandle?.stop();
  await fastify.close();
  // Drain any buffered Axiom entries before the process exits.
  await logger.flushTransports();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
