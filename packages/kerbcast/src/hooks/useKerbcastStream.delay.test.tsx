/**
 * `useKerbcastStream`'s optional delayed-playout wiring (M2 design §5 —
 * "media delay (kerbcast)"). `DelayedPlayoutBuffer` itself is exhaustively
 * covered by `../DelayedPlayoutBuffer.test.ts`; this file only proves the
 * hook plumbs a delay option through to it correctly.
 *
 * jsdom can't produce a real WebRTC `MediaStream`/track (see
 * `CameraFeed.test.tsx`'s docstring, and the SDK's `MockSidecar.deliverTrack`
 * needing a real `MediaStreamTrack`), so — rather than fighting that —
 * this uses a minimal fake `KerbcastDataSource`-shaped data source that
 * exposes an opaque stream-reference token through the exact surface the
 * hook reads (`getClient().camera(id).mediaStream` + `.on("stream", cb)`).
 * The delay clock is a manually-driven double, same discipline as
 * `DelayedPlayoutBuffer.test.ts`'s `manualClock`.
 */

import { clearRegistry, registerDataSource } from "@gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import { useDelayedPlayout, useKerbcastStream } from "./useKerbcastStream";

afterEach(() => {
  cleanup();
  clearRegistry();
});

function manualClock(initialEdge = Number.NEGATIVE_INFINITY): DelayClockLike & {
  setEdge(v: number): void;
} {
  let edge = initialEdge;
  const listeners = new Set<(viewUt: number) => void>();
  return {
    confirmedEdgeUt: () => edge,
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setEdge(v: number) {
      edge = v;
      listeners.forEach((cb) => {
        cb(v);
      });
    },
  };
}

/** Fake camera handle: an opaque "stream" token stands in for a
 *  `MediaStream` (see file docstring). */
function fakeCameraHandle(initial: unknown = null) {
  let stream = initial;
  const listeners = new Set<(s: unknown) => void>();
  return {
    get mediaStream() {
      return stream;
    },
    on(event: string, cb: (s: unknown) => void) {
      if (event !== "stream") return () => {};
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(next: unknown) {
      stream = next;
      listeners.forEach((cb) => {
        cb(next);
      });
    },
  };
}

function registerFakeKerbcastSource(cam: ReturnType<typeof fakeCameraHandle>) {
  const fake = {
    id: "kerbcast",
    getClient: () => ({ camera: () => cam }),
    subscribeCamera: () => {},
    unsubscribeCamera: () => {},
  };
  registerDataSource(
    fake as unknown as Parameters<typeof registerDataSource>[0],
  );
}

function StreamProbe({
  flightId,
  clock,
  captureUt,
  resetEpoch,
  onStream,
}: {
  flightId: number | null;
  clock: DelayClockLike;
  captureUt: () => number;
  resetEpoch?: number;
  onStream: (s: MediaStream | null) => void;
}): null {
  const raw = useKerbcastStream(flightId);
  const stream = useDelayedPlayout(raw, {
    view: clock,
    captureUt,
    resetEpoch,
  });
  onStream(stream);
  return null;
}

describe("useKerbcastStream — delayed playout wiring", () => {
  it("holds a fresh stream reference back until confirmedEdgeUt reaches its stamped capture UT, then surfaces it", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    const streams: unknown[] = [];
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 100}
        onStream={(s) => {
          latest = s;
          streams.push(s);
        }}
      />,
    );
    expect(latest).toBeNull(); // nothing released yet — buffer just built

    act(() => {
      cam.emit("stream-token-A");
    });
    // Stream arrived (stamped ut=100) but the clock hasn't caught up.
    expect(latest).toBeNull();

    act(() => {
      clock.setEdge(100);
    });
    expect(latest).toBe("stream-token-A");
  });

  it("without a delay option, behaves as the unchanged strict passthrough", () => {
    const cam = fakeCameraHandle("live-token");
    registerFakeKerbcastSource(cam);

    let latest: unknown = "unset";
    function PassthroughProbe({ flightId }: { flightId: number | null }): null {
      latest = useKerbcastStream(flightId);
      return null;
    }
    render(<PassthroughProbe flightId={7} />);

    // No held-back delay: the raw stream surfaces immediately.
    expect(latest).toBe("live-token");
  });

  it("flushes the buffer on a resetEpoch bump — a pre-reset stream never surfaces after", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    const { rerender } = render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    act(() => {
      cam.emit("pre-reset-token");
    });
    expect(latest).toBeNull(); // held — edge hasn't reached ut=500

    // Timeline reset: bump resetEpoch (rerender with the new option value,
    // same component/view identity so the buffer instance is preserved and
    // the flush-on-resetEpoch effect — not an unmount/remount — is what's
    // under test).
    rerender(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        resetEpoch={1}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    // Even once the clock sweeps far past the discarded frame's UT, the
    // pre-reset stream never surfaces.
    act(() => {
      clock.setEdge(10_000);
    });
    expect(latest).toBeNull();
  });

  it("clears an already-surfaced stream on reset — stale frame doesn't linger on screen", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    const { rerender } = render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 200}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    act(() => {
      cam.emit("pre-reset-token");
    });
    act(() => {
      clock.setEdge(200);
    });
    // Frame released and on screen before the reset happens.
    expect(latest).toBe("pre-reset-token");

    rerender(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 200}
        resetEpoch={1}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    // The stale pre-reset frame must not linger on screen — the feed goes
    // to "no frame / resyncing" rather than showing outdated video.
    expect(latest).toBeNull();
  });

  it("clears delayedStream when the raw stream disconnects (goes null) under delayed mode", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 50}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    act(() => {
      cam.emit("live-token");
    });
    act(() => {
      clock.setEdge(50);
    });
    expect(latest).toBe("live-token");

    act(() => {
      cam.emit(null); // camera disconnect
    });
    // Delayed mode must go to null on disconnect too, matching passthrough.
    expect(latest).toBeNull();
  });
});
