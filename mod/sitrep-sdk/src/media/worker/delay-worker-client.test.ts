import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CreateWorkerFrameDelayStreamOptions,
  createWorkerFrameDelayStream,
} from "./delay-worker-client";

/**
 * A worker the test drives by hand: it answers nothing on its own, as one that
 * failed to load does.
 */
class SilentWorker {
  static built: SilentWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;

  constructor() {
    SilentWorker.built.push(this);
  }

  postMessage(): void {}

  terminate(): void {
    this.terminated = true;
  }
}

const options: CreateWorkerFrameDelayStreamOptions = {
  view: {
    snapshot: () => ({
      epoch: 0,
      maxSampleUt: Number.NEGATIVE_INFINITY,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    }),
    confirmedEdgeUt: () => Number.NEGATIVE_INFINITY,
    onFrame: () => () => {},
  },
  getCaptureSample: () => ({ ut: null, warpRate: 1, atMs: 0 }),
};

/** The one thing the client asks of a camera: its video track. */
class OneTrackStream {
  getVideoTracks(): object[] {
    return [{}];
  }
}

function camera(): MediaStream {
  return new MediaStream();
}

afterEach(() => {
  vi.unstubAllGlobals();
  SilentWorker.built = [];
});

describe("createWorkerFrameDelayStream when the worker fails", () => {
  it("answers with no stream and the reason, never leaving the camera waiting", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    vi.stubGlobal("MediaStream", OneTrackStream);
    const onError = vi.fn();

    const waiting = createWorkerFrameDelayStream(camera(), {
      ...options,
      onError,
    });
    const [worker] = SilentWorker.built;
    worker?.onerror?.({ message: "the script did not load" });

    await expect(waiting).resolves.toBeNull();
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/did not load/);
    expect(worker?.terminated).toBe(true);
  });

  it("starts a new worker for the next camera", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    vi.stubGlobal("MediaStream", OneTrackStream);
    const first = createWorkerFrameDelayStream(camera(), options);
    SilentWorker.built[0]?.onerror?.({ message: "died" });
    await first;

    const second = createWorkerFrameDelayStream(camera(), options);

    expect(SilentWorker.built).toHaveLength(2);
    SilentWorker.built[1]?.onerror?.({ message: "died again" });
    await expect(second).resolves.toBeNull();
  });
});
