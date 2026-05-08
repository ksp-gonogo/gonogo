import { hostname } from "node:os";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { AxiomTransport, logger } from "@gonogo/logger";
import Fastify from "fastify";
import { registerKosBridge } from "./bridge.js";
import { BUILD_TIME, VERSION } from "./version.js";

const port = Number(process.env.PORT ?? 3001);

// Ship logs to Axiom when an ingest token is present. Mirrors the
// browser wiring in packages/app/src/main.tsx — without AXIOM_TOKEN,
// no transport is installed, so dev/test never reach Axiom unless an
// operator opts in via `.env`/`.env.local`.
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

// Tag every entry with this proxy's identity. The hostname:port is
// stable enough for "all logs from this telnet-proxy" filters in
// Axiom — there's no broker peer id to use.
const proxyId = `${hostname()}:${port}`;
logger.setIdentity({ role: "telnet-proxy", id: proxyId });

logger.info(`gonogo telnet-proxy v${VERSION} (build ${BUILD_TIME})`);

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(websocket);

// Bridge Fastify's per-request log line through @gonogo/logger so HTTP
// traffic shows up in Axiom alongside the existing `[kos-bridge]`
// lifecycle events. Without this, only kOS-terminal sessions are
// visible remotely — `/version` probes from the main screen and any
// future routes stay invisible past the local pino output.
//
// Successful responses (<400) at info; >=400 promoted to warn so a
// blip is filterable without scraping every line. WebSocket upgrades
// don't fire onResponse — those keep their own lifecycle logs in the
// kOS bridge. Body / headers excluded on purpose to avoid log volume
// blow-up and keep the leak surface narrow.
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

registerKosBridge(fastify, {
  kosHost: process.env.KOS_HOST ?? "localhost",
  kosPort: Number(process.env.KOS_PORT ?? 5410),
});

fastify.get("/status", async () => {
  return { status: "ok" };
});

fastify.get("/version", async () => {
  return { version: VERSION, buildTime: BUILD_TIME };
});

await fastify.listen({ port, host: "0.0.0.0" });

logger.info(`gonogo telnet-proxy listening on port ${port}`);

const shutdown = async () => {
  logger.info("shutting down");
  await fastify.close();
  // Drain any buffered Axiom entries before the process exits.
  await logger.flushTransports();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
