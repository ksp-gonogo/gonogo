/**
 * `useKerbcastStream`'s optional delayed-playout wiring (M2 design §5 —
 * "media delay (kerbcast)"), post cross-browser kerbcast video-delay
 * (2026-07-16). `useDelayedPlayout` now returns a discriminated
 * `DelayedPlayoutResult` (`"raw" | "connecting" | "delayed" |
 * "unavailable"`) instead of `MediaStream | null`, and tries TWO backends
 * in order — Chrome's main-thread Breakout Box, then a worker-hosted one —
 * before ever reporting `"unavailable"`. Per decision 5 of the design
 * (`docs/superpowers/specs/2026-07-16-kerbcast-video-delay-cross-browser-design.md`),
 * there is NO live-passthrough fallback anymore when delay was requested:
 * a browser that can build neither backend reports `"unavailable"`, full
 * stop — never the raw stream.
 *
 * jsdom can't produce a real WebRTC `MediaStream`/track, has no
 * `MediaStreamTrackProcessor`/`Generator` (Chrome's shape), and has no
 * `Worker` either — so EVERY test in the first `describe` block below
 * exercises the "neither backend can build here" path, which is exactly
 * what a real, fully-unsupported browser would see too. That's the direct
 * successor to this file's old "fallback-path" tests — same real,
 * un-stubbed jsdom behaviour, just asserting the new (correct) outcome:
 * `"unavailable"`, never a live token.
 *
 * The second `describe` block stubs the three WebCodecs/DOM globals
 * `createFrameDelayStream` touches so Backend 1 (main-thread) actually
 * builds — the real build → camera-switch dispose+rebuild →
 * resetEpoch-flush → unmount-dispose wiring in `useDelayedPlayout` runs
 * end to end, same as before this rewrite.
 *
 * The genuine per-frame delay-TIMING proof (frame N released only once the
 * clock reaches frame N's own stamped UT) lives at the pipeline level in
 * `../frameDelay.blockColour.test.ts`. This file proves the HOOK's
 * lifecycle wiring AND backend-selection/status reporting.
 */

import {
  clearRegistry,
  clearUplinkHandles,
  registerUplinkHandle,
} from "@ksp-gonogo/core";
import type { DelayClockLike } from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DelayedPlayoutResult,
  useDelayedPlayout,
  useKerbcastStream,
} from "./useKerbcastStream";

// Testing Library auto-cleans the DOM after every test — no manual cleanup()
// needed here, only the registry teardown this file actually owns.
afterEach(() => {
  clearRegistry();
  clearUplinkHandles();
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
  registerUplinkHandle("kerbcast", fake);
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
 * dispose code in `frameDelay.ts` (Backend 1, Chrome's main-thread shape)
 * runs against fakes instead of hitting the "neither backend available"
 * path. Each stubbed constructor records every instance it creates (reset
 * per call, since the classes are defined fresh each time) so tests can
 * assert on cancel/close/rebuild.
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
  onResult,
}: {
  flightId: number | null;
  clock: DelayClockLike;
  captureUt: () => number;
  resetEpoch?: number;
  onResult: (r: DelayedPlayoutResult) => void;
}): null {
  const raw = useKerbcastStream(flightId);
  const result = useDelayedPlayout(raw, {
    view: clock,
    captureUt,
    resetEpoch,
  });
  onResult(result);
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

  it("with a delay option, on a browser with NEITHER backend (this test env: no WebCodecs, no snapshot()-capable clock, no Worker), reports unavailable — never a live token, never a throw", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: DelayedPlayoutResult | "unset" = "unset";
    expect(() => {
      render(
        <StreamProbe
          flightId={7}
          clock={clock}
          captureUt={() => 100}
          onResult={(r) => {
            latest = r;
          }}
        />,
      );
    }).not.toThrow();
    expect(latest).toEqual({ kind: "connecting" }); // no camera stream yet

    act(() => {
      cam.emit("stream-token-A");
    });
    // Neither backend can be built here (no WebCodecs track-IO APIs, and the
    // fake clock has no snapshot() for the worker backend to fall back on)
    // — this is the "can't delay -> no video" case (decision 5). The
    // opaque token must NEVER surface.
    expect(latest).toMatchObject({ kind: "unavailable" });
    expect(
      (latest as unknown as DelayedPlayoutResult & { kind: "unavailable" })
        .reason,
    ).toEqual(expect.any(String));
  });

  it("reports connecting (not unavailable) when the raw stream disconnects (goes null) after previously being unavailable", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 50}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );

    act(() => {
      cam.emit("live-token");
    });
    expect(latest).toMatchObject({ kind: "unavailable" }); // no backend here

    act(() => {
      cam.emit(null); // camera disconnect
    });
    // Nothing to attempt building against anymore — back to "connecting",
    // not stuck reporting the previous unavailability.
    expect(latest).toEqual({ kind: "connecting" });
  });

  it("a resetEpoch bump never throws when there's no pipeline to flush (still unavailable)", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: DelayedPlayoutResult | "unset" = "unset";
    const { rerender } = render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        onResult={(r) => {
          latest = r;
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
          onResult={(r) => {
            latest = r;
          }}
        />,
      );
    }).not.toThrow();
    expect(latest).toMatchObject({ kind: "unavailable" });
  });

  it("switching cameras (a new raw stream reference) never surfaces either camera's live token here (no backend exists to build a pipeline)", () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 10}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );

    act(() => {
      cam.emit("camera-A-token");
    });
    expect(latest).toMatchObject({ kind: "unavailable" });

    act(() => {
      cam.emit("camera-B-token");
    });
    expect(latest).toMatchObject({ kind: "unavailable" });
  });

  it("attempts the worker backend when the clock supports snapshot(), and still reports unavailable in this test env (jsdom has no Worker) — proving Backend 2 was reached, not skipped", async () => {
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0) as DelayClockLike & {
      setEdge(v: number): void;
      snapshot(): unknown;
    };
    clock.snapshot = () => ({
      epoch: 0,
      anchorWall: undefined,
      anchorUt: undefined,
      maxSampleUt: Number.NEGATIVE_INFINITY,
      delaySeconds: 0,
      warpRate: 1,
      slackSeconds: 0,
    });

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 10}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );

    act(() => {
      cam.emit("camera-A-token");
    });

    await waitFor(() => {
      expect(latest).toMatchObject({ kind: "unavailable" });
    });
    // The reason should reflect "no backend in this browser", not the
    // "clock doesn't support snapshot()" message the previous test's
    // plain `manualClock()` produces — proving a DIFFERENT code path ran.
    expect(
      (latest as unknown as DelayedPlayoutResult & { kind: "unavailable" })
        .reason,
    ).not.toMatch(/snapshot/);
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

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 100}
        onResult={(r) => {
          latest = r;
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
    expect(latest).toMatchObject({ kind: "delayed" });
    const delayed = latest as unknown as DelayedPlayoutResult & {
      kind: "delayed";
    };
    expect(delayed.stream).not.toBe(rawStream);
    const generator = FakeGenerator.instances[0];
    expect(
      (
        delayed.stream as unknown as { getVideoTracks(): unknown[] }
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

    let latest: DelayedPlayoutResult | "unset" = "unset";
    render(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 10}
        onResult={(r) => {
          latest = r;
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
    expect(latest).toMatchObject({ kind: "delayed" });
    const pipelineAStream = (
      latest as unknown as DelayedPlayoutResult & { kind: "delayed" }
    ).stream;

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
    expect(latest).toMatchObject({ kind: "delayed" });
    const pipelineBStream = (
      latest as unknown as DelayedPlayoutResult & { kind: "delayed" }
    ).stream;
    expect(pipelineBStream).not.toBe(pipelineAStream);
    expect(pipelineBStream).not.toBe(streamB);
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
        onResult={() => {}}
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

    await waitFor(() => {
      expect(staleFrame.closeCount).toBe(0); // pulled off source, queued
    });
    expect(gen?.written).toEqual([]); // not released — edge is -Infinity

    rerender(
      <StreamProbe
        flightId={7}
        clock={clock}
        captureUt={() => 500}
        resetEpoch={1}
        onResult={() => {}}
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

  // Delay is a property of the CAMERA, not the viewer. Two consumers of one
  // camera (e.g. a CameraFeed and the docking-HUD backdrop) must share ONE
  // delayed pipeline — a MediaStreamTrack admits only one
  // MediaStreamTrackProcessor, and two viewers showing DIFFERENT delays of the
  // same lens would be incoherent anyway. Proven at the hook boundary here;
  // the cache mechanics live in `shared-delayed-streams.test.ts`.
  it("two consumers of ONE camera share a single processor and see the same delayed output", () => {
    const { FakeProcessor, FakeGenerator } = installFakeWebCodecs();
    const track = fakeControllableVideoTrack();
    const rawStream = fakeVideoStream(track);
    const cam = fakeCameraHandle(null);
    registerFakeKerbcastSource(cam);
    const clock = manualClock(0);

    let resultA: DelayedPlayoutResult | "unset" = "unset";
    let resultB: DelayedPlayoutResult | "unset" = "unset";
    render(
      <>
        <StreamProbe
          flightId={7}
          clock={clock}
          captureUt={() => 100}
          onResult={(r) => {
            resultA = r;
          }}
        />
        <StreamProbe
          flightId={7}
          clock={clock}
          captureUt={() => 100}
          onResult={(r) => {
            resultB = r;
          }}
        />
      </>,
    );

    act(() => {
      cam.emit(rawStream); // the SAME MediaStream object reaches both consumers
    });

    // ONE processor / generator for the shared track — not two colliding ones.
    expect(FakeProcessor.instances).toHaveLength(1);
    expect(FakeGenerator.instances).toHaveLength(1);
    // Both consumers see a delayed stream, and it is the SAME object.
    expect(resultA).toMatchObject({ kind: "delayed" });
    expect(resultB).toMatchObject({ kind: "delayed" });
    const streamA = (resultA as DelayedPlayoutResult & { kind: "delayed" })
      .stream;
    const streamB = (resultB as DelayedPlayoutResult & { kind: "delayed" })
      .stream;
    expect(streamA).toBe(streamB);
  });

  it("a SECOND, different camera builds its own independent processor (both delayed simultaneously)", () => {
    const { FakeProcessor } = installFakeWebCodecs();
    const trackA = fakeControllableVideoTrack();
    const trackB = fakeControllableVideoTrack();
    const streamA = fakeVideoStream(trackA);
    const streamB = fakeVideoStream(trackB);
    const camA = fakeCameraHandle(streamA);
    const camB = fakeCameraHandle(streamB);
    // A source that hands out a DIFFERENT camera per flightId, so the two
    // probes resolve two distinct raw MediaStreams (distinct cache keys).
    registerUplinkHandle("kerbcast", {
      id: "kerbcast",
      getClient: () => ({
        camera: (id: number) => (id === 7 ? camA : camB),
      }),
      subscribeCamera: () => {},
      unsubscribeCamera: () => {},
    });
    const clock = manualClock(0);

    let resultA: DelayedPlayoutResult | "unset" = "unset";
    let resultB: DelayedPlayoutResult | "unset" = "unset";
    render(
      <>
        <StreamProbe
          flightId={7}
          clock={clock}
          captureUt={() => 100}
          onResult={(r) => {
            resultA = r;
          }}
        />
        <StreamProbe
          flightId={8}
          clock={clock}
          captureUt={() => 100}
          onResult={(r) => {
            resultB = r;
          }}
        />
      </>,
    );

    // Two independent processors — the normal multi-camera case works, and the
    // per-camera keying doesn't collapse distinct cameras into one pipeline.
    expect(FakeProcessor.instances).toHaveLength(2);
    expect(resultA).toMatchObject({ kind: "delayed" });
    expect(resultB).toMatchObject({ kind: "delayed" });
    const sA = (resultA as DelayedPlayoutResult & { kind: "delayed" }).stream;
    const sB = (resultB as DelayedPlayoutResult & { kind: "delayed" }).stream;
    expect(sA).not.toBe(sB);
  });
});
