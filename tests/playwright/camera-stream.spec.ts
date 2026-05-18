import { bootstrapPair, expect, teardownPair, type BootstrappedPair } from "./helpers";
import { test } from "@playwright/test";

/**
 * End-to-end media-stream test. Boots the full stack via
 * `playwright.config.ts` (broker, telemachus-replay, fake OCISLY, real
 * relay, vite dev server) and asserts that:
 *
 *   1. The CameraFeed widget on the **main** screen subscribes to the
 *      relay, receives a WebRTC video track, and the `<video>`
 *      element reports non-zero `videoWidth`/`videoHeight`.
 *   2. The same widget on the **station** screen receives an
 *      equivalent track via the relay-peer-id PeerJS broadcast and
 *      the station's PeerClient bridge.
 *   3. The frame index encoded by the fake OCISLY in a top-left grey
 *      block lands in the same range on both screens (within a
 *      tolerance for the natural one-or-two-frame skew between
 *      independent decoders).
 *
 * The frame-index assertion is the user's "compare ascending numbers
 * across screens" idea, automated: the fake OCISLY paints the value
 * of `frameCounter mod 256` into the top 32×32 corner of every JPEG
 * it serves; this spec samples that block via canvas + getImageData
 * on each video element and compares.
 */

const CAMERA_ID = "cam-test-1";
const BLOCK_PX = 16; // sample inset, not the encoder block size

interface FrameSample {
  /** Average grey value of the top-left block (0–255). */
  greyAvg: number;
  /** Width / height the video element reports — both must be > 0. */
  videoWidth: number;
  videoHeight: number;
  /** Did the capture itself succeed end-to-end? */
  ok: boolean;
  /** When ok=false, a short reason. */
  reason: string | null;
}

async function sampleVideo(page: import("@playwright/test").Page): Promise<FrameSample> {
  return await page.evaluate(async (blockPx) => {
    const video = document.querySelector("video") as HTMLVideoElement | null;
    if (!video) {
      return {
        greyAvg: 0,
        videoWidth: 0,
        videoHeight: 0,
        ok: false,
        reason: "no <video> element on page",
      };
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return {
        greyAvg: 0,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        ok: false,
        reason: "video has zero dimensions — track not flowing",
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = blockPx;
    canvas.height = blockPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        greyAvg: 0,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        ok: false,
        reason: "2d context unavailable",
      };
    }
    // Sample the top-left block. The encoder paints a 32×32 corner;
    // we sample a smaller 16×16 inside it to avoid the block-edge
    // bleed JPEG introduces.
    ctx.drawImage(video, 0, 0, blockPx, blockPx, 0, 0, blockPx, blockPx);
    const data = ctx.getImageData(0, 0, blockPx, blockPx).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]; // R channel
    return {
      greyAvg: sum / (data.length / 4),
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      ok: true,
      reason: null,
    };
  }, blockPx);
}

const blockPx = BLOCK_PX;

test.describe("multi-screen WebRTC media stream", () => {
  let pair: BootstrappedPair | null = null;

  test.afterEach(async () => {
    if (pair) {
      await teardownPair(pair);
      pair = null;
    }
  });

  test("main and station both render the camera feed and see the same frame index", async ({
    browser,
  }) => {
    pair = await bootstrapPair(browser, "camera-feed", {
      widget: {
        size: { w: 6, h: 6 },
        config: {
          mode: "single",
          cameraId: CAMERA_ID,
          showOverlay: false,
          showMetadata: false,
        },
      },
      waitForMain: async (page) => {
        // The CameraFeed widget renders only a Placeholder until the
        // OCISLY stream source reports at least one camera id. Wait
        // for the actual `<video>` element to appear — that's the
        // signal that the relay's `cameras` message reached the host,
        // the widget picked a stream, and the React tree mounted the
        // Feed view.
        await page.waitForSelector("video", { timeout: 30_000 });
      },
    });

    // The WebRTC handshake (peer offer → answer, ICE, decoder warm-up)
    // is the longest pole — give it generous headroom on a cold relay.
    await Promise.all(
      [pair.main, pair.station].map((page) =>
        page.waitForFunction(
          () => {
            const v = document.querySelector(
              "video",
            ) as HTMLVideoElement | null;
            return !!v && v.videoWidth > 0 && v.videoHeight > 0;
          },
          undefined,
          { timeout: 30_000, polling: 250 },
        ),
      ),
    );

    // One more tick so both sides have decoded at least a few frames —
    // sampling on the very first decoded frame can hit a partial paint
    // depending on the renderer's compositing schedule.
    await pair.main.waitForTimeout(500);
    await pair.station.waitForTimeout(500);

    const [mainSample, stationSample] = await Promise.all([
      sampleVideo(pair.main),
      sampleVideo(pair.station),
    ]);

    expect(mainSample.ok, mainSample.reason ?? "main capture failed").toBe(
      true,
    );
    expect(
      stationSample.ok,
      stationSample.reason ?? "station capture failed",
    ).toBe(true);

    // Both video elements have non-zero dimensions — track is flowing.
    expect(mainSample.videoWidth).toBeGreaterThan(0);
    expect(stationSample.videoWidth).toBeGreaterThan(0);

    // The fake encoder writes a non-trivial grey value: `frameCounter
    // mod 256`. A captured frame that has all-zero corners would mean
    // the sampler is hitting black (e.g. before the first track frame
    // paints, or a placeholder image). We don't pin a specific value
    // — frame counters race — but neither side should sample to ~0.
    expect(mainSample.greyAvg).toBeGreaterThan(20);
    expect(stationSample.greyAvg).toBeGreaterThan(20);

    // Frame skew between the two screens should be small. The fake
    // increments per call and the relay polls at 30 fps; a one-frame
    // skew is ~8 units of grey delta. Allow ±64 — that covers the
    // network-jitter worst case and JPEG quantisation noise without
    // letting a "completely different image" through (the wrap-around
    // makes 0 and 255 *look* close — but only if there's a real
    // mod-256 collision, which is fine).
    const delta = Math.abs(mainSample.greyAvg - stationSample.greyAvg);
    const wrap = Math.min(delta, 256 - delta);
    expect(wrap).toBeLessThanOrEqual(64);
  });
});
