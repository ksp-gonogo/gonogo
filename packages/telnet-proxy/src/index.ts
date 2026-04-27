import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerKosBridge } from "./bridge.js";
import { BUILD_TIME, VERSION } from "./version.js";

const fastify = Fastify({ logger: true });

console.log(`gonogo telnet-proxy v${VERSION} (build ${BUILD_TIME})`);

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

const port = Number(process.env.PORT ?? 3001);
await fastify.listen({ port, host: "0.0.0.0" });

console.log(`gonogo proxy running on port ${port}`);
