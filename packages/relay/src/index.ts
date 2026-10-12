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
import { startCoturn } from "./coturnManager.js";
import { discoverPublicIp } from "./discoverPublicIp.js";
import { registerTurnRoutes } from "./turnRoutes.js";
import { TurnSupervisor } from "./turnSupervisor.js";
import { BUILD_TIME, VERSION } from "./version.js";

const config = loadConfig();

// Ship logs to Axiom only when the token is present AND the host has
// enabled analytics consent (relayed in via POST /analytics-config). The
// token is the credential; consent is the runtime gate. Default is
// DISABLED until the first POST: privacy-first. Console/pino output is
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
          // Node has no `pagehide`; the SIGINT/SIGTERM shutdown path calls `logger.flushTransports()` instead.
          flushOnPageHide: false,
        })
      : null,
});

logger.info(`gonogo relay v${VERSION} (build ${BUILD_TIME})`);

const fastify = Fastify({ logger: true });

// Bridge fastify's pino output through @ksp-gonogo/logger so every line
// hitting stderr/stdout also reaches Axiom (when configured). Pino
// still writes to its own stream: this is purely additive.
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
// excluded: log volume + leak surface from no benefit to the
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
 * This process's primary non-internal IPv4: the address coturn can actually
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
// child process with a fresh per-restart secret. With no public IP the relay
// stays up without TURN and retries discovery; a coturn that cannot spawn or
// that dies makes the relay exit non-zero so the container restarts.
// ──────────────────────────────────────────────────────────────────────

let exiting = false;

/** Drain buffered logs, then end the process; safe to call more than once. */
async function exitNow(code: number): Promise<never> {
  if (!exiting) {
    exiting = true;
    await logger.flushTransports();
  }
  process.exit(code);
}

const turn = new TurnSupervisor({
  discover: () =>
    discoverPublicIp({ override: config.turnExternalIp ?? undefined }),
  onDiscoveryFailed: (err) =>
    bridgeError(
      "public IP discovery failed, TURN unavailable until a retry succeeds",
      err,
    ),
  onFatal: (reason) => {
    bridgeError(`coturn failed (${reason}), exiting so the container restarts`);
    void exitNow(1);
  },
  start: (externalIp, onExit) => {
    // The address coturn actually binds relay sockets on. When externalIp is
    // a NAT / published / host-LAN address (the container case, externalIp is
    // the host's LAN IP, this process sees only the container's 10.x), coturn
    // must bind the local interface and merely advertise externalIp. Pass our
    // own primary non-internal IPv4 as the `/private` half.
    const localIp = primaryLocalIpv4();
    bridgeInfo(
      `relay TURN advertise=${externalIp}${localIp && localIp !== externalIp ? ` bind=${localIp}` : ""}`,
    );
    return startCoturn({
      externalIp,
      port: config.turnPort,
      minPort: config.turnMinPort,
      maxPort: config.turnMaxPort,
      // Only attach the private half when it differs, `X/X` is pointless, and when externalIp is itself local (native runs) coturn binds it fine.
      localIp: localIp && localIp !== externalIp ? localIp : undefined,
      denyPrivatePeers: config.publicRelay,
      onExit,
      logger: {
        info: (msg, ...args) => bridgeInfo(msg, { args }),
        error: (msg, ...args) => bridgeError(msg, undefined, { args }),
      },
    });
  },
});

if (config.skipCoturn) {
  bridgeInfo(
    "SKIP_COTURN set: relay will run without TURN (intended for localhost tests)",
  );
} else {
  await turn.begin();
}

// Stable id for this relay process's lifetime, used only to tag log entries so a single relay's lines are filterable in Axiom.
const relayId = randomUUID();
logger.setIdentity({ role: "relay", id: relayId, peerId: relayId });

registerTurnRoutes(fastify, {
  getCoturn: () => turn.handle,
  getPendingReason: () => turn.pendingReason,
  turnExpected: !config.skipCoturn,
});

fastify.get("/version", async () => ({
  version: VERSION,
  buildTime: BUILD_TIME,
}));

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
await fastify.listen({ port: config.port, host: "0.0.0.0" });
bridgeInfo(`relay listening on :${config.port}`);

const shutdown = async () => {
  bridgeInfo("shutting down");
  await turn.stop();
  await fastify.close();
  await exitNow(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
