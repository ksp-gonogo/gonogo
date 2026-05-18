#!/usr/bin/env node
/**
 * Fake OCISLY gRPC server for the Playwright media-stream integration
 * test.
 *
 * The real OCISLY camera server is a linux/amd64-only published image
 * that the relay (packages/relay) connects to over gRPC and polls for
 * JPEG-encoded camera frames. Running it locally requires Docker + qemu
 * emulation on Apple Silicon (~80s cold start), which is too slow for
 * a CI-friendly test loop.
 *
 * This fake implements the same `CameraStream` service from
 * packages/relay/protos/camerastream.proto:
 *   - `GetActiveCameraIds` → returns a single hard-coded camera id.
 *   - `GetCameraTexture` → returns a freshly-generated JPEG so the
 *     relay's decoder + WebRTC encoder both have real work to do; the
 *     image has a moving stripe so a station-side video element shows
 *     a non-static frame.
 *   - `GetAverageFps` → returns a constant.
 *   - `SendCameraStream` → no-op (used only by KSP-side senders).
 *
 * Listens on the port specified by `FAKE_OCISLY_PORT` (default 5078,
 * one above the production-default 5077 so a real OCISLY in docker
 * can run alongside without colliding).
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

// jpeg-js is published as CJS; pnpm hoists the relay's copy to the
// workspace root so a plain createRequire reaches it.
const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js");

const PORT = Number.parseInt(process.env.FAKE_OCISLY_PORT ?? "5078", 10);
const CAMERA_ID = process.env.FAKE_OCISLY_CAMERA_ID ?? "cam-test-1";
const CAMERA_NAME = process.env.FAKE_OCISLY_CAMERA_NAME ?? "TestCam";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "packages",
  "relay",
  "protos",
  "camerastream.proto",
);

const definition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(definition);
const service = proto.CameraStream.CameraStream.service;

// Frame generator — 128×128 RGBA with two channels of information:
//   1. A 32×32 grey block in the top-left whose intensity encodes
//      `frameCounter mod 256`. JPEG-quality=85 preserves the average
//      pixel value of a uniform 32-px block within a few units of the
//      source, which is good enough for the multi-screen Playwright
//      assertion: each page captures its own video element, samples
//      that corner block, and confirms both screens see the same
//      frame index (within a small tolerance for one-frame skew).
//   2. A vertical stripe whose x position shifts every call so the
//      image is visibly animating — handy when running the test
//      headed for debug, and reassures the encoder/decoder that the
//      input isn't a constant flat image (which some codecs special-
//      case in ways that would skip the frame).
const WIDTH = 128;
const HEIGHT = 128;
const BLOCK_SIZE = 32;
let frameCounter = 0;

function makeJpegFrame() {
  const idx = frameCounter & 0xff; // 0..255, the value we encode
  frameCounter += 1;
  const stripeX = (frameCounter * 3) % WIDTH;
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      const inBlock = x < BLOCK_SIZE && y < BLOCK_SIZE;
      if (inBlock) {
        // Grey block — R=G=B=idx so any channel works for the readback.
        pixels[i] = idx;
        pixels[i + 1] = idx;
        pixels[i + 2] = idx;
      } else {
        const stripe = Math.abs(x - stripeX) <= 1;
        pixels[i] = stripe ? 255 : 32; // R
        pixels[i + 1] = stripe ? 200 : 48; // G
        pixels[i + 2] = stripe ? 80 : 64; // B
      }
      pixels[i + 3] = 255; // A
    }
  }
  const encoded = jpeg.encode(
    { data: pixels, width: WIDTH, height: HEIGHT },
    85,
  );
  return encoded.data;
}

const impl = {
  GetActiveCameraIds(_call, callback) {
    callback(null, { cameras: [CAMERA_ID] });
  },
  GetCameraTexture(call, callback) {
    const cameraId = call.request?.cameraId ?? CAMERA_ID;
    if (cameraId !== CAMERA_ID) {
      callback({
        code: grpc.status.NOT_FOUND,
        message: `unknown camera ${cameraId}`,
      });
      return;
    }
    callback(null, {
      cameraId: CAMERA_ID,
      cameraName: CAMERA_NAME,
      speed: "0",
      altitude: "0",
      texture: makeJpegFrame(),
    });
  },
  GetAverageFps(_call, callback) {
    callback(null, { averageFps: 30 });
  },
  SendCameraStream(_call, callback) {
    callback(null, {});
  },
};

const server = new grpc.Server();
server.addService(service, impl);
server.bindAsync(
  `0.0.0.0:${PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (err, boundPort) => {
    if (err) {
      console.error("[ocisly-fake] bind failed:", err);
      process.exit(1);
    }
    // server.start() is no longer required after a successful bindAsync —
    // grpc-js logs a DeprecationWarning if you call it. The server is
    // listening once the callback fires.
    console.log(
      `[ocisly-fake] listening on :${boundPort} — camera=${CAMERA_ID} (${CAMERA_NAME})`,
    );
  },
);

function shutdown(signal) {
  console.log(`[ocisly-fake] received ${signal}; shutting down`);
  server.tryShutdown(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
