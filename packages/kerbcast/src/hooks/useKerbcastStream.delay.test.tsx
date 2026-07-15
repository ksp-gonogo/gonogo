/**
 * `useKerbcastStream`'s optional delayed-playout wiring (M2 design §5 —
 * "media delay (kerbcast)"), post kerbcast-per-frame-video-delay
 * (2026-07-15). `useDelayedPlayout` now builds a real per-frame pipeline
 * (`../frameDelay.ts`) instead of stamping once per raw `MediaStream`
 * *reference* — see that file's docstring for the fixed history.
 *
 * jsdom can't produce a real WebRTC `MediaStream`/track, and (as of
 * writing) doesn't implement the WebCodecs track-IO APIs
 * (`MediaStreamTrackProcessor`/`MediaStreamTrackGenerator`) the real
 * pipeline needs — so in THIS test environment, requesting delay always
 * hits the documented "unsupported browser" fallback path. That's not a
 * gap: it's the exact path real Safari/Firefox users hit too, and it's
 * worth covering directly (per the spec's risk note — "flag which, don't
 * silently drop" — rather than silently falling through to a black feed).
 *
 * The genuine per-frame delay-TIMING proof (frame N released only once the
 * clock reaches frame N's own stamped UT) lives at the pipeline level in
 * `../frameDelay.blockColour.test.ts`, where the source/sink are injectable
 * fakes and no real browser API is needed. This file only proves the hook
 * plumbs options through and degrades safely when the real pipeline can't
 * be built.
 *
 * Same no-hook-mocking discipline as before: a fake `KerbcastDataSource`-
 * shaped data source stands in for the SDK, and a manually-driven clock
 * double stands in for the delay clock.
 */

import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
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
  it("without a delay option, behaves as the unchanged strict passthrough — no pipeline attempted", () => {
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

  it("with a delay option, on a browser lacking the WebCodecs track-IO pipeline (this test env), falls back to LIVE passthrough — never a black feed, never a throw", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    expect(() => {
      render(
        <StreamProbe
          flightId={7}
          clock={clock}
          captureUt={() => 100}
          onStream={(s) => {
            latest = s;
          }}
        />,
      );
    }).not.toThrow();
    expect(latest).toBeNull(); // no camera stream yet

    act(() => {
      cam.emit("stream-token-A");
    });
    // Fallback path: the opaque token (a stand-in for a real MediaStream
    // with no video track / no WebCodecs support) surfaces immediately —
    // NOT held back — because a real per-frame pipeline could not be built
    // here. This is the same "unsupported browser" path a real
    // Safari/Firefox user hits.
    expect(latest).toBe("stream-token-A");
  });

  it("clears delayedStream when the raw stream disconnects (goes null), even on the fallback path", () => {
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
    expect(latest).toBe("live-token");

    act(() => {
      cam.emit(null); // camera disconnect
    });
    // Delayed mode must go to null on disconnect too, matching passthrough.
    expect(latest).toBeNull();
  });

  it("a resetEpoch bump never throws, whether or not a real pipeline exists", () => {
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
      cam.emit("some-token");
    });

    expect(() => {
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
    }).not.toThrow();
    // Fallback path is unaffected by a reset — still live.
    expect(latest).toBe("some-token");
  });

  it("switching cameras (a new raw stream reference) tears down and rebuilds cleanly, with no stale frame lingering", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: unknown = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 10}
        onStream={(s) => {
          latest = s;
        }}
      />,
    );

    act(() => {
      cam.emit("camera-A-token");
    });
    expect(latest).toBe("camera-A-token");

    act(() => {
      cam.emit("camera-B-token");
    });
    expect(latest).toBe("camera-B-token");
  });
});
