import jpeg from "jpeg-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraPoller } from "../grpc/cameraPoller.js";
import type { CameraFrame, OcislyClient } from "../grpc/OcislyClient.js";

function makeJpeg(width = 8, height = 8): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  rgba.fill(255);
  return jpeg.encode({ data: rgba, width, height }, 90).data;
}

function makeFakeClient(initial: Partial<CameraFrame> = {}): OcislyClient {
  const frame: CameraFrame = {
    cameraId: "cam-1",
    cameraName: "Hullcam 1",
    speed: "1000",
    altitude: "50000",
    texture: makeJpeg(),
    ...initial,
  };
  return {
    getActiveCameraIds: vi.fn(async () => ["cam-1"]),
    getCameraTexture: vi.fn(async () => frame),
    getAverageFps: vi.fn(async () => 30),
    close: vi.fn(),
  } as unknown as OcislyClient;
}

describe("CameraPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling on first subscribe, returns same source on subsequent subscribes", async () => {
    const client = makeFakeClient();
    const poller = new CameraPoller({ client, framesPerSecond: 50 });

    const sourceA = poller.subscribe("cam-1");
    const sourceB = poller.subscribe("cam-1");
    expect(sourceA).toBe(sourceB);

    // Let the initial immediate tick + awaits resolve.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(client.getCameraTexture).toHaveBeenCalledTimes(1);

    poller.release("cam-1");
    poller.release("cam-1");
    poller.shutdown();
  });

  it("stops polling after the last subscriber releases", async () => {
    const client = makeFakeClient();
    const poller = new CameraPoller({ client, framesPerSecond: 100 });

    poller.subscribe("cam-1");
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    const callsBeforeRelease = (
      client.getCameraTexture as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    poller.release("cam-1");
    await vi.advanceTimersByTimeAsync(500);
    const callsAfterRelease = (
      client.getCameraTexture as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    // Polling stopped — at most one additional in-flight call may have resolved.
    expect(callsAfterRelease - callsBeforeRelease).toBeLessThanOrEqual(1);

    poller.shutdown();
  });

  it("records the latest metadata returned from the server", async () => {
    const frame: CameraFrame = {
      cameraId: "cam-1",
      cameraName: "Forward Hullcam",
      speed: "2345.6",
      altitude: "75000",
      texture: makeJpeg(),
    };
    const client = {
      getActiveCameraIds: vi.fn(async () => ["cam-1"]),
      getCameraTexture: vi.fn(async () => frame),
      getAverageFps: vi.fn(async () => 0),
      close: vi.fn(),
    } as unknown as OcislyClient;

    const poller = new CameraPoller({ client, framesPerSecond: 50 });
    poller.subscribe("cam-1");

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(poller.latestMetadata("cam-1")).toEqual({
      cameraId: "cam-1",
      cameraName: "Forward Hullcam",
      speed: "2345.6",
      altitude: "75000",
    });

    poller.release("cam-1");
    poller.shutdown();
  });

  it("skips pushJpeg when the texture buffer is empty", async () => {
    const client = {
      getActiveCameraIds: vi.fn(async () => []),
      getCameraTexture: vi.fn(async () => ({
        cameraId: "cam-1",
        cameraName: "",
        speed: "",
        altitude: "",
        texture: Buffer.alloc(0),
      })),
      getAverageFps: vi.fn(async () => 0),
      close: vi.fn(),
    } as unknown as OcislyClient;

    const poller = new CameraPoller({ client, framesPerSecond: 50 });
    const source = poller.subscribe("cam-1");

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // No frame pushed — metadata is still captured for downstream consumers.
    expect(source.frameCount).toBe(0);
    expect(poller.latestMetadata("cam-1")?.cameraId).toBe("cam-1");

    poller.release("cam-1");
    poller.shutdown();
  });

  it("does not send overlapping polls when a tick is still in flight", async () => {
    let resolveFrame: ((f: CameraFrame) => void) | null = null;
    const client = {
      getActiveCameraIds: vi.fn(async () => []),
      getCameraTexture: vi.fn(
        () =>
          new Promise<CameraFrame>((resolve) => {
            resolveFrame = resolve;
          }),
      ),
      getAverageFps: vi.fn(async () => 0),
      close: vi.fn(),
    } as unknown as OcislyClient;

    const poller = new CameraPoller({ client, framesPerSecond: 100 });
    poller.subscribe("cam-1");

    // Initial immediate tick fires 1 call; while it's pending, advance timers —
    // no additional calls should fire because inFlight is set.
    await Promise.resolve();
    expect(client.getCameraTexture).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(client.getCameraTexture).toHaveBeenCalledTimes(1);

    // Resolve the pending call — from here, timers can queue a new one.
    resolveFrame?.({
      cameraId: "cam-1",
      cameraName: "",
      speed: "",
      altitude: "",
      texture: makeJpeg(),
    });

    poller.release("cam-1");
    poller.shutdown();
  });
});
