// IMPORTANT: must be first import. Installs wrtc globals as a module
// side-effect so they're in place before peerjs/webrtc-adapter sniff them.
import "./peer/globals.js";

import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import { AxiomTransport, logger } from "@gonogo/logger";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { type CoturnHandle, startCoturn } from "./coturnManager.js";
import { discoverPublicIp } from "./discoverPublicIp.js";
import { CameraPoller } from "./grpc/cameraPoller.js";
import { OcislyClient } from "./grpc/OcislyClient.js";
import { PeerHost } from "./peer/PeerHost.js";
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
// between OCISLY-peer events, which makes "did the host reach the
// relay before timing out?" debugging from afar impossible.
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

const ocisly = new OcislyClient(`${config.ocislyHost}:${config.ocislyPort}`);

// Throttle per-camera metadata to ~2 Hz. Telemetry (speed/altitude) changes
// slowly; sending on every 30fps frame would spam data channels for no gain.
// peerHost is assigned below — poller → peerHost is an intentional
// late-binding cycle (poller receives peerHost as a caller, peerHost receives
// poller in its opts).
const METADATA_BROADCAST_INTERVAL_MS = 500;
const lastMetadataSentAt = new Map<string, number>();
let peerHost: PeerHost | null = null;

const poller = new CameraPoller({
  client: ocisly,
  framesPerSecond: 30,
  onFrame: (meta) => {
    const now = Date.now();
    const last = lastMetadataSentAt.get(meta.cameraId) ?? 0;
    if (now - last < METADATA_BROADCAST_INTERVAL_MS) return;
    lastMetadataSentAt.set(meta.cameraId, now);
    peerHost?.broadcastMetadata(meta);
  },
  logger: { error: (msg, err) => bridgeError(msg, err) },
});

// ──────────────────────────────────────────────────────────────────────
// Discover the public IP coturn should advertise, then start coturn as a
// child process with a fresh per-restart secret. Fail-soft: if discovery
// or coturn spawn fails, the relay still serves cameras over LAN, but
// the /ice-config endpoint will report an unreachable TURN. The browser
// readiness probe surfaces that to operators.
// ──────────────────────────────────────────────────────────────────────

let coturnHandle: CoturnHandle | null = null;
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

const proxyPeerId = `ocisly-${randomUUID()}`;
// Tag every log entry with this relay's identity. proxyPeerId is the
// natural id — it's stable for this process's lifetime and is what
// other peers see on the broker side.
logger.setIdentity({ role: "relay", id: proxyPeerId, peerId: proxyPeerId });

peerHost = new PeerHost({
  peerId: proxyPeerId,
  client: ocisly,
  poller,
  // STUN only — no TURN on the relay side. ICE prefers a TURN-relay
  // candidate over srflx whenever one is available; wiring our own
  // coturn here made the local case strictly worse because it pushed
  // the path through the same coturn (two hairpins through the
  // router) and exhausted the small port pool. Without TURN here,
  // ICE falls back to srflx-via-hairpin — the path that was carrying
  // the local case for weeks. STUN is still required: with no STUN
  // the @roamhq/wrtc inside the container can't even discover its
  // public IP, so it only gathers the 10.89.x.x bridge candidate
  // (unreachable from the macOS host) and ICE has no working pair
  // at all. External stations consume the host's TURN candidate via
  // SDP signalling, so they still get TURN coverage for restrictive
  // networks — the relay itself doesn't need to relay.
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  logger: {
    info: (msg, ...args) => bridgeInfo(msg, { args }),
    error: (msg, ...args) => bridgeError(msg, undefined, { args }),
  },
});

fastify.get("/health", async () => ({
  status: "ok",
  ocislyTarget: `${config.ocislyHost}:${config.ocislyPort}`,
  peerId: proxyPeerId,
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

fastify.get("/peer-id", async () => ({ peerId: proxyPeerId }));

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

fastify.get("/cameras", async (_req, reply) => {
  try {
    const cameras = await ocisly.getActiveCameraIds();
    return { cameras };
  } catch (err) {
    bridgeError("GetActiveCameraIds failed", err);
    return reply.status(502).send({ error: "ocisly server unreachable" });
  }
});

fastify.get("/cameras/stats", async () => ({
  cameras: poller.stats(),
}));

// Debugging aid: returns the most recent JPEG for a camera straight from the
// OCISLY server, bypassing the whole WebRTC pipeline. If the image here looks
// wrong, the problem is upstream (KSP mod / Unity render target). If the
// image looks right but the <video> feed is wrong, the problem is in our
// JPEG→I420→WebRTC encode.
fastify.get<{ Params: { cameraId: string } }>(
  "/cameras/:cameraId/snapshot.jpg",
  async (req, reply) => {
    try {
      const frame = await ocisly.getCameraTexture(req.params.cameraId);
      if (!frame.texture || frame.texture.length === 0) {
        return reply.status(404).send({ error: "camera has no texture yet" });
      }
      reply.type("image/jpeg");
      return reply.send(frame.texture);
    } catch (err) {
      bridgeError("GetCameraTexture failed", err);
      return reply.status(502).send({ error: "ocisly server unreachable" });
    }
  },
);

// Start the peer host but don't block listen if the broker is unreachable — log and carry on.
try {
  await peerHost.start();
} catch (err) {
  bridgeError("peer host failed to open — broker unreachable?", err);
}

await fastify.listen({ port: config.port, host: "0.0.0.0" });
bridgeInfo(
  `relay listening on :${config.port}, bridging to ${config.ocislyHost}:${config.ocislyPort}, peerId=${proxyPeerId}`,
);

const shutdown = async () => {
  bridgeInfo("shutting down");
  peerHost?.stop();
  poller.shutdown();
  ocisly.close();
  await coturnHandle?.stop();
  await fastify.close();
  // Drain any buffered Axiom entries before the process exits.
  await logger.flushTransports();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
