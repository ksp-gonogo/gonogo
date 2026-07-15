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
 * pipeline needs. Two groups of tests live here:
 *
 * - **Fallback-path tests** (the "…on the fallback path" / "…live
 *   passthrough" titles) exercise jsdom's REAL, un-stubbed behaviour:
 *   `isFrameDelaySupported()` is false, so requesting delay hits the
 *   documented "unsupported browser" fallback. That's not a gap — it's the
 *   exact path real Safari/Firefox users hit too, worth covering directly
 *   (per the spec's risk note — "flag which, don't silently drop" — rather
 *   than silently falling through to a black feed).
 * - **Supported-path tests** (the "…stubbed WebCodecs…" titles) stub the
 *   three browser globals `createFrameDelayStream` touches
 *   (`MediaStreamTrackProcessor`, `MediaStreamTrackGenerator`, `MediaStream`)
 *   with minimal fakes via `installFakeWebCodecs()` below, so the REAL build
 *   → camera-switch dispose+rebuild → resetEpoch-flush → unmount-dispose
 *   wiring in `useDelayedPlayout` actually runs, at this layer, instead of
 *   only ever taking the no-pipeline branch. (Prior to this, every hook test
 *   here exercised only the fallback branch, so the pipeline lifecycle this
 *   hook owns — build/dispose/rebuild/flush — was untested at the layer
 *   that owns it; see review finding #2,
 *   `local_docs/Wednesday Work/2026-07-15-kerbcast-per-frame-video-delay-review.md`.)
 *   Stubbing the browser globals (not `createFrameDelayStream` itself) is
 *   the "real seam" per the repo's testing philosophy — the actual pipeline
 *   code runs, only the WebCodecs constructors are doubles.
 *
 * The genuine per-frame delay-TIMING proof (frame N released only once the
 * clock reaches frame N's own stamped UT) lives at the pipeline level in
 * `../frameDelay.blockColour.test.ts`. This file proves the HOOK's
 * lifecycle wiring — what gets built/torn down/flushed and when — on both
 * the fallback and the supported path.
 *
 * Same no-hook-mocking discipline as before: a fake `KerbcastDataSource`-
 * shaped data source stands in for the SDK, and a manually-driven clock
 * double stands in for the delay clock.
 */

import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** A fake "video frame" — the minimal `FrameLike` contract `../frameDelay.ts`
 *  requires, plus a spy so tests can assert `.close()` was called. Mirrors
 *  `frameDelay.test.ts`'s `fakeFrame`. */
function fakeFrame(label: string) {
  return {
    label,
    closeCount: 0,
    close() {
      this.closeCount += 1;
    },
  };
}
type FakeFrame = ReturnType<typeof fakeFrame>;

/** A controllable fake video track: `push()` delivers a frame to whichever
 *  `FakeProcessor` reader is currently reading it (immediately if a read is
 *  already pending, queued otherwise) — lets a test inject a frame into the
 *  REAL pipeline built by the hook, without a real `MediaStreamTrack`. */
function fakeControllableVideoTrack() {
  const queue: FakeFrame[] = [];
  let pendingResolve: ((r: { done: false; value: FakeFrame }) => void) | null =
    null;
  return {
    kind: "video" as const,
    push(frame: FakeFrame) {
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ done: false, value: frame });
      } else {
        queue.push(frame);
      }
    },
    read(): Promise<{ done: false; value: FakeFrame }> {
      const next = queue.shift();
      if (next) return Promise.resolve({ done: false, value: next });
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
  };
}
type FakeControllableVideoTrack = ReturnType<typeof fakeControllableVideoTrack>;

/** A raw `MediaStream` stand-in that actually implements `getVideoTracks()`
 *  — unlike the opaque string tokens used elsewhere in this file, this one
 *  can drive the SUPPORTED path, where `createFrameDelayStream` looks for a
 *  real video track on `raw`. */
function fakeVideoStream(track: FakeControllableVideoTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

/**
 * Stubs the three WebCodecs/DOM globals `createFrameDelayStream` touches
 * (`MediaStreamTrackProcessor`, `MediaStreamTrackGenerator`, `MediaStream`)
 * with minimal fakes wired to `fakeControllableVideoTrack`, so
 * `isFrameDelaySupported()` reports true and the REAL pipeline build/
 * dispose code in `frameDelay.ts` runs against fakes instead of hitting the
 * "unsupported browser" early-return. Each stubbed constructor records every
 * instance it creates (reset per call, since the classes are defined fresh
 * each time) so tests can assert on cancel/close/rebuild.
 *
 * Same technique `frameDelay.test.ts` already uses for its narrower
 * "no video track" fixture — extended here to a full fake pipeline so the
 * HOOK's lifecycle wiring can be driven end to end.
 */
function installFakeWebCodecs() {
  class FakeProcessor {
    static instances: FakeProcessor[] = [];
    cancelled = false;
    readable: { getReader(): unknown };
    constructor(public init: MediaStreamTrackProcessorInit) {
      FakeProcessor.instances.push(this);
      const track = init.track as unknown as FakeControllableVideoTrack;
      this.readable = {
        getReader: () => ({
          read: () => track.read(),
          cancel: () => {
            this.cancelled = true;
            return Promise.resolve();
          },
        }),
      };
    }
  }

  class FakeGenerator {
    static instances: FakeGenerator[] = [];
    closed = false;
    written: unknown[] = [];
    writable: { getWriter(): unknown };
    constructor(public init: MediaStreamTrackGeneratorInit) {
      FakeGenerator.instances.push(this);
      this.writable = {
        getWriter: () => ({
          write: (frame: unknown) => {
            this.written.push(frame);
            return Promise.resolve();
          },
          close: () => {
            this.closed = true;
            return Promise.resolve();
          },
        }),
      };
    }
  }

  class FakeMediaStream {
    constructor(public tracks: unknown[] = []) {}
    getVideoTracks() {
      return this.tracks;
    }
  }

  vi.stubGlobal("MediaStreamTrackProcessor", FakeProcessor);
  vi.stubGlobal("MediaStreamTrackGenerator", FakeGenerator);
  vi.stubGlobal("MediaStream", FakeMediaStream);

  return {
    FakeProcessor,
    FakeGenerator,
    FakeMediaStream,
    restore: () => vi.unstubAllGlobals(),
  };
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

  it("a resetEpoch bump never throws on the fallback path (no pipeline to flush)", () => {
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

  it("switching cameras (a new raw stream reference) swaps the passthrough token cleanly on the fallback path (no pipeline exists here to tear down)", () => {
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

describe("useKerbcastStream — delayed playout wiring (SUPPORTED path, stubbed WebCodecs)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("with a delay option and a supported browser, builds a real per-frame pipeline and returns its output stream — never the raw camera stream", () => {
    const { FakeProcessor, FakeGenerator } = installFakeWebCodecs();
    const track = fakeControllableVideoTrack();
    const rawStream = fakeVideoStream(track);
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: MediaStream | null = null;
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

    act(() => {
      cam.emit(rawStream);
    });

    // A real processor/generator pair was built for the raw track...
    expect(FakeProcessor.instances).toHaveLength(1);
    expect(FakeGenerator.instances).toHaveLength(1);
    expect(FakeProcessor.instances[0]?.init.track).toBe(track);
    // ...and the hook surfaces the PIPELINE's output stream (wrapping the
    // generator), not the raw camera stream — this is the build-happy-path
    // no jsdom-fallback test could previously reach.
    expect(latest).not.toBe(rawStream);
    const generator = FakeGenerator.instances[0];
    expect(
      (
        latest as unknown as { getVideoTracks(): unknown[] }
      ).getVideoTracks()[0],
    ).toBe(generator);
  });

  it("switching cameras disposes the OLD pipeline (reader cancelled, writer closed) before building a fresh one for the new track — no leaked pipeline, no cross-camera bleed", () => {
    const { FakeProcessor, FakeGenerator } = installFakeWebCodecs();
    const trackA = fakeControllableVideoTrack();
    const trackB = fakeControllableVideoTrack();
    const streamA = fakeVideoStream(trackA);
    const streamB = fakeVideoStream(trackB);
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: MediaStream | null = null;
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
      cam.emit(streamA);
    });
    expect(FakeProcessor.instances).toHaveLength(1);
    const [procA] = FakeProcessor.instances;
    const [genA] = FakeGenerator.instances;
    expect(procA?.cancelled).toBe(false);
    expect(genA?.closed).toBe(false);
    const pipelineAStream = latest;

    act(() => {
      cam.emit(streamB);
    });

    // The OLD pipeline (camera A) is fully torn down on the switch...
    expect(procA?.cancelled).toBe(true);
    expect(genA?.closed).toBe(true);
    // ...and a fresh pipeline is built for the new track...
    expect(FakeProcessor.instances).toHaveLength(2);
    expect(FakeProcessor.instances[1]?.init.track).toBe(trackB);
    // ...surfaced as a NEW output stream, not the torn-down one.
    expect(latest).not.toBe(pipelineAStream);
    expect(latest).not.toBe(streamB);
  });

  it("a resetEpoch bump flushes the supported-path pipeline's buffer (drops+closes the stale queued frame) WITHOUT disposing the pipeline — the track keeps flowing", async () => {
    const { FakeProcessor, FakeGenerator } = installFakeWebCodecs();
    const track = fakeControllableVideoTrack();
    const rawStream = fakeVideoStream(track);
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    // Edge frozen at -Infinity: nothing this test pushes ever releases on
    // its own, so any frame still queued when we assert must have been
    // dropped by flush(), not delivered.
    const clock = manualClock(Number.NEGATIVE_INFINITY);

    const { rerender } = render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        onStream={() => {}}
      />,
    );

    act(() => {
      cam.emit(rawStream);
    });
    expect(FakeProcessor.instances).toHaveLength(1);
    const [proc] = FakeProcessor.instances;
    const [gen] = FakeGenerator.instances;

    const staleFrame = fakeFrame("stale");
    track.push(staleFrame);

    await vi.waitFor(() => {
      expect(staleFrame.closeCount).toBe(0); // pulled off source, queued
    });
    expect(gen?.written).toEqual([]); // not released — edge is -Infinity

    rerender(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        resetEpoch={1}
        onStream={() => {}}
      />,
    );

    // flush(): the stale queued frame is dropped AND closed, never
    // written to the sink.
    expect(staleFrame.closeCount).toBe(1);
    expect(gen?.written).toEqual([]);
    // flush() ≠ dispose(): same pipeline instance, track still open, no
    // rebuild.
    expect(proc?.cancelled).toBe(false);
    expect(gen?.closed).toBe(false);
    expect(FakeProcessor.instances).toHaveLength(1);
  });
});
