// Render-time setup for this Uplink's own scenes.
//
// The one Uplink whose widget cannot be photographed off the stream alone.
// `CameraFeed` shows a WebRTC track, so what puts it in its real has-a-feed
// state is a live `MediaStream` and a sidecar session that delivered it, and
// neither is a topic. This stands both up: the kerbcast SDK's own `MockSidecar`,
// the same fake the vitest suite drives, plus a canvas painting a camera view
// into `captureStream()`, which is a thing only a real browser can do.
//
// The scene's own shape still comes from its fixture. What is here is the fake
// nobody else could write, which is what this file is for.
import { type MockCameraInit, MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import { registerUplinkHandle } from "@ksp-gonogo/sitrep-sdk";
import { defineRenderSetup } from "@ksp-gonogo/ui-kit/render-probe";
import { KerbcastDataSource } from "./src/KerbcastDataSource";

/**
 * The camera each scene is of, by fixture name.
 *
 * What varies between these scenes is the CAMERA's capabilities rather than
 * anything on the stream, and a camera is not a topic: it arrives over the
 * sidecar's own channel. So the scene picks its camera here, by the fixture's
 * own name, which is the one thing the setup is told about the scene it is
 * about to feed.
 */
const CAMERAS: Record<string, MockCameraInit> = {
  "camera-feed-steerable": {
    ...base(),
    supportsZoom: true,
    supportsPan: true,
    fovMin: 10,
    fovMax: 90,
    panYaw: 18,
    panPitch: -10,
    panYawMin: -90,
    panYawMax: 90,
    panPitchMin: -45,
    panPitchMax: 45,
  },
  "camera-feed-fixed": {
    ...base(),
    cameraName: "Nose Cam",
    supportsZoom: false,
    supportsPan: false,
  },
};

/** Everything a camera carries that is not about how it can be steered. */
function base(): MockCameraInit {
  return {
    flightId: 42,
    partTitle: "Hullcam Mk1",
    cameraName: "Starboard Cam",
    vesselName: "Kerbal X",
    renderWidth: 384,
    renderHeight: 384,
    operatorWidth: 384,
    operatorHeight: 384,
    fov: 45,
    encoderBitrateBps: 1_500_000,
  };
}

const FEED_PX = 384;

let source: KerbcastDataSource | null = null;
let rafId = 0;
let realFetch: typeof fetch | null = null;

/**
 * A camera view: a star field and a planet limb rising into frame.
 *
 * Deliberately synthetic rather than a captured still. What the scenes are of is
 * the CHROME over the feed, and a recognisably-drawn backdrop reads as "a feed
 * is here" without anyone mistaking it for a real capture.
 */
function paintScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(205,222,255,0.75)";
  for (let i = 0; i < 90; i++) {
    const size = 1 + (i % 2);
    ctx.fillRect((i * 71 + 11) % w, (i * 97 + 30) % (h * 0.66), size, size);
  }
  const limb = ctx.createLinearGradient(0, h * 0.6, 0, h);
  limb.addColorStop(0, "#2f72a0");
  limb.addColorStop(1, "#0c2230");
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.ellipse(
    w / 2,
    h * 1.25 + Math.sin(t) * 6,
    w * 0.95,
    h * 0.7,
    0,
    Math.PI,
    2 * Math.PI,
  );
  ctx.fill();
  ctx.strokeStyle = "rgba(130,190,235,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(
    w / 2,
    h * 1.25 + Math.sin(t) * 6,
    w * 0.95,
    h * 0.7,
    0,
    Math.PI,
    2 * Math.PI,
  );
  ctx.stroke();
}

/** A live `captureStream`, so the widget is in its real has-a-track state
 *  rather than in one only this harness can produce. */
function startCanvasStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = FEED_PX;
  canvas.height = FEED_PX;
  canvas.style.cssText = `position:fixed;left:-9999px;top:0;width:${FEED_PX}px;height:${FEED_PX}px;`;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("kerbcast render setup: no 2d context");
  let t = 0;
  const draw = (): void => {
    t += 0.02;
    paintScene(ctx, FEED_PX, FEED_PX, t);
    rafId = requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(30);
}

/**
 * A drawn backdrop between the video and the chrome.
 *
 * Headless Chromium does not paint a `captureStream` into a `<video>`, so the
 * element is there, in its real state, and black. A canvas inserted as the
 * video's next sibling stacks above it and below the controls, which is what
 * makes the feed visible in the picture. The widget itself is untouched.
 */
function paintFeedBackdrop(): void {
  const video = document.querySelector("video");
  const stage = video?.parentElement;
  if (!video || !stage) return;
  const rect = stage.getBoundingClientRect();
  const backdrop = document.createElement("canvas");
  backdrop.width = Math.max(2, Math.round(rect.width));
  backdrop.height = Math.max(2, Math.round(rect.height));
  backdrop.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;";
  const ctx = backdrop.getContext("2d");
  if (ctx) paintScene(ctx, backdrop.width, backdrop.height, 0.6);
  stage.insertBefore(backdrop, video.nextSibling);
}

export default defineRenderSetup({
  async beforeScene({ scene, starve }) {
    // A starved scene gets no sidecar at all, which is the point of the
    // comparison: a widget that looks the same with and without a camera is a
    // picture of the chrome rather than of a feed.
    if (starve) return;
    const camera = CAMERAS[scene.fixture];
    if (!camera) {
      throw new Error(
        `kerbcast render setup: no camera for scene "${scene.fixture}". Add ` +
          "one to CAMERAS, keyed by the fixture's own file name.",
      );
    }
    const sidecar = new MockSidecar();
    sidecar.addCamera(camera);
    source = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());
    // The handle, not `registerDataSource`: the feed's own hooks reach the
    // source by handle, so a source registered only as a DataSource is a source
    // the widget never finds, and the render is of the no-cameras state.
    registerUplinkHandle("kerbcast", source);

    // The connect handshake. `/ice-config` answers with no relay, and the
    // `/offer` answer names the camera so the client opens a track for the one
    // it is about to learn about.
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/ice-config")) {
        return new Response(JSON.stringify({ iceServers: [] }), {
          status: 200,
        });
      }
      return MockSidecar.makeOfferResponse([camera.flightId]);
    }) as typeof fetch;

    // The track follows the subscription rather than the registration order:
    // the client binds a camera to a slot mid, and that is the mid its media
    // has to arrive on. Set before connecting, since the bind happens during it.
    const track = startCanvasStream().getVideoTracks()[0];
    sidecar.onSubscribe((_flightId, mid) => {
      if (track) sidecar.deliverTrack(mid, track);
    });

    await source.connect();
    // Opening the channel is what pushes hello and the camera snapshot.
    sidecar.open();
    sidecar.setConnectionState("connected");
  },

  async afterMount({ starve }) {
    if (starve) return;
    // The snapshot has to reach the widget and the track has to attach before
    // there is a `<video>` to sit behind.
    await new Promise((resolve) => setTimeout(resolve, 400));
    paintFeedBackdrop();
  },

  afterScene() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (realFetch) {
      globalThis.fetch = realFetch;
      realFetch = null;
    }
    source?.disconnect();
    source = null;
  },
});
