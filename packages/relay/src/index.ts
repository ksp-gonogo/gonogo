import { randomUUID } from "node:crypto";
import {
  AxiomConsentController,
  AxiomTransport,
  logger,
} from "@ksp-gonogo/logger";
import Fastify from "fastify";
import { registerAnalyticsConfigRoutes } from "./analyticsConfig.js";
import { registerAppOrigins } from "./appOrigins.js";
import { registerBootstrapConfigRoutes } from "./bootstrapConfig.js";
import { loadConfig } from "./config.js";
import { discoverPublicIp } from "./discoverPublicIp.js";
import { type EndpointHandle, startEndpoint } from "./endpointManager.js";
import { registerHealthRoutes } from "./healthRoutes.js";
import {
  defaultGateway,
  endpointPorts,
  gatewayCandidates,
  PortMapper,
  sweepCandidates,
} from "./portMapper.js";
import { PublicServiceSupervisor } from "./publicServiceSupervisor.js";
import { registerStationsProxy } from "./stationsProxy.js";
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

// Stable id for this relay process's lifetime, used only to tag log entries so a single relay's lines are filterable in Axiom.
const relayId = randomUUID();
logger.setIdentity({ role: "relay", id: relayId, peerId: relayId });

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

await registerAppOrigins(fastify, new Set(config.appOrigins));

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

// Discover the public IP the station endpoint advertises, then start it. With
// no public IP the relay stays up without it and retries discovery; an
// endpoint that cannot spawn or that dies makes the relay exit non-zero so
// the container restarts.

let exiting = false;

/** Drain buffered logs, then end the process; safe to call more than once. */
async function exitNow(code: number): Promise<never> {
  if (!exiting) {
    exiting = true;
    await logger.flushTransports();
  }
  process.exit(code);
}

const UNDISCOVERED =
  "public IP not discovered; set PUBLIC_IP or restore internet access";

const discover = () =>
  discoverPublicIp({ override: config.publicIp ?? undefined });

const endpoint = new PublicServiceSupervisor<EndpointHandle>({
  name: "endpoint",
  undiscoveredReason: UNDISCOVERED,
  discover,
  onDiscoveryFailed: (err) =>
    bridgeError(
      "public IP discovery failed, the station endpoint is unavailable until a retry succeeds",
      err,
    ),
  onFatal: (reason) => {
    bridgeError(
      `endpoint failed (${reason}), exiting so the container restarts`,
    );
    void exitNow(1);
  },
  start: (publicIp, onExit) =>
    startEndpoint({
      binaryPath: config.endpointBinary,
      port: config.endpointPort,
      control: `127.0.0.1:${config.endpointControlPort}`,
      publicIp,
      lanIp: config.lanIp,
      omitUdp: config.endpointOmitUdp,
      onExit,
      logger: {
        info: (msg) => bridgeInfo(msg),
        error: (msg) => bridgeError(msg),
      },
    }),
});

if (config.skipEndpoint) {
  bridgeInfo(
    "SKIP_ENDPOINT set: relay will run without the station endpoint, so only stations on this network can join",
  );
} else {
  await endpoint.begin();
}

const portMapper =
  config.skipEndpoint || !config.portMapping
    ? null
    : new PortMapper({
        gateways: gatewayCandidates(config.routerIp, defaultGateway()),
        ports: endpointPorts(config.endpointPort),
        sweep: config.routerIp ? [] : sweepCandidates(),
        lanIp: config.lanIp,
        log: (msg) => bridgeInfo(`port mapping: ${msg}`),
      });
void portMapper?.start();

registerHealthRoutes(fastify, {
  getEndpoint: () => endpoint.handle,
  getPendingReason: () => endpoint.pendingReason,
  endpointExpected: !config.skipEndpoint,
  getPortMapping: () => portMapper?.status ?? null,
});

registerStationsProxy(fastify, {
  target: { host: "127.0.0.1", port: config.endpointControlPort },
  extraOrigins: new Set(config.appOrigins),
});

fastify.get("/version", async () => ({
  version: VERSION,
  buildTime: BUILD_TIME,
}));

// Analytics-config broker: the host POSTs its consent here, the relay
// exposes it (GET + SSE) for any service that wants to gate on it, and gates
// its OWN Axiom sink on it via the onChange callback.
registerAnalyticsConfigRoutes(fastify, {
  onRunId: (runId) => logger.setRunId(runId),
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
  await portMapper?.stop();
  await endpoint.stop();
  await fastify.close();
  await exitNow(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
