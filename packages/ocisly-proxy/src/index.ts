// IMPORTANT: must be first import. Installs wrtc globals as a module
// side-effect so they're in place before peerjs/webrtc-adapter sniff them.
import "./peer/globals.js";

import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { CameraPoller } from "./grpc/cameraPoller.js";
import { OcislyClient } from "./grpc/OcislyClient.js";
import { PeerHost } from "./peer/PeerHost.js";
import { BUILD_TIME, VERSION } from "./version.js";

console.log(`gonogo ocisly-proxy v${VERSION} (build ${BUILD_TIME})`);

const config = loadConfig();
const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

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
  logger: { error: (msg, err) => fastify.log.error({ err }, msg) },
});

const proxyPeerId = `ocisly-${randomUUID()}`;
peerHost = new PeerHost({
  peerId: proxyPeerId,
  client: ocisly,
  poller,
  iceServers: config.iceServers.map((s) => ({
    urls: s.url,
    username: s.username,
    credential: s.credential,
  })),
  logger: {
    info: (msg, ...args) => fastify.log.info({ args }, msg),
    error: (msg, ...args) => fastify.log.error({ args }, msg),
  },
});

fastify.get("/health", async () => ({
  status: "ok",
  ocislyTarget: `${config.ocislyHost}:${config.ocislyPort}`,
  peerId: proxyPeerId,
}));

fastify.get("/version", async () => ({
  version: VERSION,
  buildTime: BUILD_TIME,
}));

fastify.get("/peer-id", async () => ({ peerId: proxyPeerId }));

fastify.get("/cameras", async (_req, reply) => {
  try {
    const cameras = await ocisly.getActiveCameraIds();
    return { cameras };
  } catch (err) {
    fastify.log.error({ err }, "GetActiveCameraIds failed");
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
      fastify.log.error({ err }, "GetCameraTexture failed");
      return reply.status(502).send({ error: "ocisly server unreachable" });
    }
  },
);

// Start the peer host but don't block listen if the broker is unreachable — log and carry on.
try {
  await peerHost.start();
} catch (err) {
  fastify.log.error({ err }, "peer host failed to open — broker unreachable?");
}

await fastify.listen({ port: config.port, host: "0.0.0.0" });
fastify.log.info(
  `ocisly-proxy listening on :${config.port}, bridging to ${config.ocislyHost}:${config.ocislyPort}, peerId=${proxyPeerId}`,
);

const shutdown = async () => {
  fastify.log.info("shutting down");
  peerHost?.stop();
  poller.shutdown();
  ocisly.close();
  await fastify.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
