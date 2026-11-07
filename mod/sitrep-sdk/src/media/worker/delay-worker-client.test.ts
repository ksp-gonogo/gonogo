import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PACING_MAX_LEAD_SECONDS } from "../frame-delay";
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

  posted: {
    type?: string;
    pipelineId?: string;
    snapshot?: { delaySeconds: number };
  }[] = [];

  postMessage(message?: { type?: string; pipelineId?: string }): void {
    if (message) this.posted.push(message);
  }

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

  describe("clock snapshots", () => {
    it("are posted per pipeline, each carrying its own camera's clock", async () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal("Worker", SilentWorker);
        vi.stubGlobal("MediaStream", OneTrackStream);
        const viewWithDelay = (delaySeconds: number) => ({
          ...options.view,
          snapshot: () => ({ ...options.view.snapshot(), delaySeconds }),
        });
        const start = (delaySeconds: number) => {
          const waiting = createWorkerFrameDelayStream(camera(), {
            ...options,
            view: viewWithDelay(delaySeconds),
          });
          const [worker] = SilentWorker.built;
          const created = worker?.posted.filter(
            (m) => m.type === "createPipeline",
          );
          const pipelineId = created?.[created.length - 1]?.pipelineId;
          worker?.onmessage?.({
            data: { type: "pipelineReady", pipelineId, track: {} },
          } as MessageEvent);
          return { waiting, pipelineId };
        };
        const hull = start(4);
        const ground = start(0.5);
        await hull.waiting;
        await ground.waiting;

        await vi.advanceTimersByTimeAsync(50);

        const [worker] = SilentWorker.built;
        const snapshots = (worker?.posted ?? []).filter(
          (m) => m.type === "clockSnapshot",
        );
        const delayOf = (id: string | undefined) =>
          new Set(
            snapshots
              .filter((m) => m.pipelineId === id)
              .map((m) => m.snapshot?.delaySeconds),
          );
        expect(delayOf(hull.pipelineId)).toEqual(new Set([4]));
        expect(delayOf(ground.pipelineId)).toEqual(new Set([0.5]));
        worker?.onerror?.({ message: "done" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("leadLimitSeconds", () => {
    it("is the default before the worker reports, then the last figure it posted", async () => {
      vi.stubGlobal("Worker", SilentWorker);
      vi.stubGlobal("MediaStream", OneTrackStream);
      const waiting = createWorkerFrameDelayStream(camera(), options);
      const [worker] = SilentWorker.built;
      const pipelineId = worker?.posted.find(
        (m) => m.type === "createPipeline",
      )?.pipelineId;
      worker?.onmessage?.({
        data: { type: "pipelineReady", pipelineId, track: {} },
      } as MessageEvent);
      const stream = await waiting;

      expect(stream?.leadLimitSeconds()).toBe(DEFAULT_PACING_MAX_LEAD_SECONDS);

      worker?.onmessage?.({
        data: { type: "pipelineLeadLimit", pipelineId, seconds: 7.5 },
      } as MessageEvent);

      expect(stream?.leadLimitSeconds()).toBe(7.5);
    });
  });
});
