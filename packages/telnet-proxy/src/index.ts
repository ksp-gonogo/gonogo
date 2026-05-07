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
