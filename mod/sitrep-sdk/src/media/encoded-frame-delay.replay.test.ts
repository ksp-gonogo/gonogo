import { describe, expect, it } from "vitest";
import recording from "./__fixtures__/hull-after-revert.json";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  attachEncodedFrameDelayTransform,
  type EncodedVideoFrameLike,
} from "./encoded-frame-delay";
import { bindFrameStamps, type FrameStamp } from "./frame-stamp-timeline";

/** The craft's one-way delay on the recorded run, in seconds. */
const DELAY_SECONDS = 23;
const RC_CAP_BYTES = 8 * 1024 * 1024;

/**
 * Replays the recorded stamps, sizes and UTs of a Hull camera after a revert
 * through the real stamp dating and the real pipeline, with the view clock at
 * the newest frame's UT less the delay. `sizeScale` multiplies each frame's
 * recorded size.
 *
 * The recording stayed at 368x208. After most reverts the camera comes back at
 * 1024x576 because its requested render size is not sent again when it
 * re-registers, which is about 3.1 times the bytes a frame.
 */
async function replay(sizeScale: number, maxBufferedBytes?: number) {
  let edge = Number.NEGATIVE_INFINITY;
  const clock: DelayClockLike = {
    confirmedEdgeUt: () => edge,
    onFrame: () => () => {},
  };
  let stampListener: ((stamp: FrameStamp) => void) | undefined;
  const bound = bindFrameStamps(
    {
      subscribe(listener) {
        stampListener = listener;
        return () => {};
      },
    },
    () => pipeline.flush(),
  );
  let controller!: ReadableStreamDefaultController<EncodedVideoFrameLike>;
  const readable = new ReadableStream<EncodedVideoFrameLike>({
    start(c) {
      controller = c;
    },
  });
  const written: EncodedVideoFrameLike[] = [];
  const writable = new WritableStream<EncodedVideoFrameLike>({
    write(frame) {
      written.push(frame);
    },
  });
  const pipeline = attachEncodedFrameDelayTransform(
    { readable, writable },
    { view: clock, captureUt: (f) => bound.captureUt(f), maxBufferedBytes },
  );

  let wall = 0;
  for (const [ut, rtpTimestamp, bytes, key] of recording.frames as [
    number,
    number,
    number,
    number,
  ][]) {
    stampListener?.({ rtpTimestamp, ut, epoch: recording.epoch });
    controller.enqueue({
      type: key ? "key" : "delta",
      data: new ArrayBuffer(Math.round(bytes * sizeScale)),
      getMetadata: () => ({ rtpTimestamp }),
    } as EncodedVideoFrameLike);
    await new Promise((resolve) => setTimeout(resolve, 0));
    edge = ut - DELAY_SECONDS;
    wall += 1 / 30;
    pipeline.tickPacing(wall);
  }
  const stats = pipeline.stats();
  pipeline.dispose();
  return { stats, written };
}

describe("a Hull camera replayed after a revert, held for the craft's delay", () => {
  it("holds the whole delay at the recorded frame sizes", async () => {
    const { stats } = await replay(1, RC_CAP_BYTES);

    expect(stats.evicted).toBe(0);
    expect(stats.shedding).toBe(false);
  });

  it("keeps the oldest frames to play out when a revert leaves the camera at 1024x576, about 3.1 times the recorded frame size, under the old 8 MiB cap", async () => {
    const { stats } = await replay(3.1, RC_CAP_BYTES);

    expect(stats.bufferedBytes).toBeLessThanOrEqual(RC_CAP_BYTES);
    expect(stats.shedding).toBe(true);
    expect(stats.buffered).toBeGreaterThan(0);
  });

  it("holds the whole delay at the 1024x576 frame size under the default cap", async () => {
    const { stats } = await replay(3.1);

    expect(stats.evicted).toBe(0);
    expect(stats.shedding).toBe(false);
  });
});
