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

/** A static-ish "camera view": star field + a planet limb, animated just
 *  enough that captureStream produces frames. */
function startCanvasStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  let t = 0;
  const draw = (): void => {
    t += 0.02;
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, 384, 384);
    ctx.fillStyle = "rgba(205,222,255,0.75)";
    for (let i = 0; i < 70; i++) {
      const x = (i * 53 + 11) % 384;
      const y = (i * 97 + 30) % 230;
      ctx.fillRect(x, y, 1 + (i % 2), 1 + (i % 2));
    }
    const cx = 192;
    const cy = 470 + Math.sin(t) * 6;
    const grd = ctx.createLinearGradient(0, 230, 0, 384);
    grd.addColorStop(0, "#2f72a0");
    grd.addColorStop(1, "#0c2230");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 370, 240, 0, Math.PI, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(130,190,235,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 370, 240, 0, Math.PI, 2 * Math.PI);
    ctx.stroke();
    rafId = requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(30);
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

  // Let connect settle, the camera-snapshot propagate, and the <video>
  // paint at least one frame.
  await new Promise((r) => setTimeout(r, 500));
}

(window as unknown as { __renderCamera: typeof renderCamera }).__renderCamera =
  renderCamera;
