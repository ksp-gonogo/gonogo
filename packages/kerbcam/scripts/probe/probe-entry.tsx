/**
 * Browser entry for the CameraFeed render harness. esbuild bundles this
 * into probe.html; `render-camera.ts` (Playwright) drives it via the
 * `window.__renderCamera` hook, then hovers the video to reveal the
 * hover-gated controls and screenshots #root.
 *
 * It mounts the REAL CameraFeed against a real KerbcamDataSource wired to
 * the in-process MockKerbcamSession (the same transport-level fake the vitest
 * suite uses), mirroring `buildConnectedSource()`. The one thing jsdom can't
 * do — a live MediaStream — works here because this runs in real Chromium:
 * a canvas.captureStream() is delivered through the mock's onTrack path, so
 * the <video> actually paints a frame behind the controls.
 */
import {
  DashboardItemContext,
  registerDataSource,
  unregisterDataSource,
} from "@gonogo/core";
import { createRoot, type Root } from "react-dom/client";
import { CameraFeed } from "../../src/CameraFeed/CameraFeed";
import { KerbcamDataSource } from "../../src/KerbcamDataSource";
import { createMockKerbcamSession } from "../../src/test/MockKerbcamSession";

interface Payload {
  camera: Record<string, unknown> & { flightId: number };
  config: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

let root: Root | null = null;
let ds: KerbcamDataSource | null = null;
let rafId = 0;

function teardown(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (root) {
    root.unmount();
    root = null;
  }
  if (ds) {
    try {
      unregisterDataSource("kerbcam");
    } catch {
      /* not registered */
    }
    ds.disconnect();
    ds = null;
  }
}

/** Paint a "camera view" — star field + a planet limb — into a 2D context of
 *  the given size. `t` animates the limb a touch. Used for both the live
 *  captureStream (track delivery) and the static render backdrop. */
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
    const x = (i * 71 + 11) % w;
    const y = (i * 97 + 30) % (h * 0.66);
    const s = 1 + (i % 2);
    ctx.fillRect(x, y, s, s);
  }
  const cx = w / 2;
  const cy = h * 1.25 + Math.sin(t) * 6;
  const rx = w * 0.95;
  const ry = h * 0.7;
  const grd = ctx.createLinearGradient(0, h * 0.6, 0, h);
  grd.addColorStop(0, "#2f72a0");
  grd.addColorStop(1, "#0c2230");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "rgba(130,190,235,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();
}

/** Live captureStream for the SDK track-delivery path (keeps CameraFeed in its
 *  real "has a stream" state). */
function startCanvasStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 384;
  canvas.style.cssText =
    "position:fixed;left:-9999px;top:0;width:384px;height:384px;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  let t = 0;
  const draw = (): void => {
    t += 0.02;
    paintScene(ctx, 384, 384, t);
    rafId = requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(30);
}

/** Insert a static noise/scene backdrop directly behind nothing-but-above the
 *  <video> so the feed area shows a representative image in the render. The
 *  <video> won't paint the captureStream in headless Chromium, so this canvas
 *  — a later DOM sibling, hence stacked above the (black) video but below the
 *  hover chrome/controls — is what makes the feed visible. Pure render-harness
 *  visual; the real widget shows the live WebRTC feed here. */
function paintFeedBackdrop(): void {
  const video = document.querySelector("video");
  const stage = video?.parentElement;
  if (!video || !stage) return;
  const rect = stage.getBoundingClientRect();
  const bg = document.createElement("canvas");
  bg.width = Math.max(2, Math.round(rect.width));
  bg.height = Math.max(2, Math.round(rect.height));
  bg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;display:block;";
  const ctx = bg.getContext("2d");
  if (ctx) paintScene(ctx, bg.width, bg.height, 0.6);
  bg.style.pointerEvents = "none";
  stage.insertBefore(bg, video.nextSibling);
}

async function renderCamera(payload: Payload): Promise<void> {
  teardown();

  const session = createMockKerbcamSession();
  ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
  registerDataSource(ds as unknown as Parameters<typeof registerDataSource>[0]);

  // /offer answer — flightIds in track order so the SDK opens a track for
  // the camera we're about to deliver.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ sdp: "answer-sdp", cameras: [payload.camera.flightId] }),
      { status: 200 },
    )) as typeof fetch;

  await ds.connect();
  session.openChannel();
  session.setState("connected");
  session.sendServerMessage({
    type: "hello",
    content: { sidecarVersion: "0.3.2", encoderBackend: "openh264" },
  });
  session.sendServerMessage({
    type: "camera-snapshot",
    content: { cameras: [payload.camera] },
  });

  const stream = startCanvasStream();
  const track = stream.getVideoTracks()[0];
  if (track) session.deliverTrack(track, 0);

  const el = document.getElementById("root");
  if (!el) throw new Error("no #root");
  el.style.width = `${payload.pxW}px`;
  el.style.height = `${payload.pxH}px`;
  root = createRoot(el);
  root.render(
    <DashboardItemContext.Provider value={{ instanceId: "probe" }}>
      <CameraFeed config={payload.config as never} id="probe" />
    </DashboardItemContext.Provider>,
  );

  // Let connect settle + the camera-snapshot propagate, then paint the feed
  // backdrop (the <video> won't reliably paint the mock stream in headless, so
  // this canvas behind the chrome is what makes the feed visible in the render).
  await new Promise((r) => setTimeout(r, 400));
  paintFeedBackdrop();
  await new Promise((r) => setTimeout(r, 100));
}

(window as unknown as { __renderCamera: typeof renderCamera }).__renderCamera =
  renderCamera;
