import { logger } from "@ksp-gonogo/logger";
import {
  attachEncodedWorkerFrameDelay,
  type BuiltDelayedStream,
  type CaptureClockSample,
  createFrameDelayStream,
  createWorkerFrameDelayStream,
  type DelayedStreamBuildContext,
  isFrameDelaySupported,
  SharedDelayedStreams,
  type SnapshottableDelayClock,
} from "@ksp-gonogo/sitrep-client";
import { type DelayClockLike, getUplinkHandle } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import type { KerbcastDataSource } from "../KerbcastDataSource";

/** A neutral capture sample for the moment before the ~1Hz clock arrives —
 *  `ut: null` makes the worker/encoded backends treat frames as un-stampable
 *  (interpolation yields `null`), never stamping against a bogus UT. */
const NEUTRAL_CAPTURE_SAMPLE: CaptureClockSample = {
  ut: null,
  warpRate: 1,
  atMs: 0,
};

/**
 * The per-lease contribution the shared cache reads: the LIVE capture-clock
 * source. A pipeline is shared across every consumer of one camera and
 * outlives whichever consumer happened to build it — so the build must read
 * the capture UT through `ctx.contribution()` (the first still-live lease's),
 * never a closure over the builder's own refs, which freeze when that
 * consumer unmounts. See `SharedDelayedStreams`' contribution-seam doc.
 */
interface CaptureContribution {
  captureUt(): number;
  getCaptureSample(): CaptureClockSample;
}

/**
 * ONE delayed pipeline per camera track, shared app-wide. Keyed by the raw
 * `MediaStream` object identity — every consumer of one kerbcast camera gets
 * the SAME `cam.mediaStream` reference (the data source refcounts the camera),
 * so two widgets on one camera share a single processor and the same delayed
 * output. A `MediaStreamTrack` admits only one `MediaStreamTrackProcessor`
 * (and an `RTCRtpReceiver` only one `RTCRtpScriptTransform`); delaying once at
 * the source is what makes a second viewer possible at all, and it halves the
 * decode cost. See `SharedDelayedStreams`.
 */
const sharedDelayedStreams = new SharedDelayedStreams<
  DelayedPlayoutResult,
  CaptureContribution
>();

/**
 * Live `MediaStream` for one kerbcast camera. Returns `null` while
 * the WebRTC track hasn't arrived yet (during connection setup, or
 * after a disconnect). Components bind the stream to a `<video>`'s
 * `srcObject` directly.
 *
 * Works on both screens. The main screen connects to the sidecar directly; a
 * station uses the brokered data source (`KerbcastDataSource.attachBroker`) — the
 * offer→answer relays through the host, but media flows station↔sidecar
 * directly, so the `MediaStream` itself never crosses PeerJS.
 *
 * This is the thin data-source glue only — a strict LAN passthrough. Delayed
 * playout is layered on top by composing it with {@link useDelayedPlayout}
 * (see `useDelayedKerbcastStream`), which keeps the SDK / buffer / clock
 * concerns cleanly separated (M2 design §5).
 */
export function useKerbcastStream(flightId: number | null): MediaStream | null {
  const [rawStream, setRawStream] = useState<MediaStream | null>(() => {
    if (flightId === null) return null;
    const ds = getUplinkHandle<KerbcastDataSource>("kerbcast");
    return ds?.getClient().camera(flightId).mediaStream ?? null;
  });

  useEffect(() => {
    if (flightId === null) {
      setRawStream(null);
      return;
    }
    const ds = getUplinkHandle<KerbcastDataSource>("kerbcast");
    if (!ds) return;
    const cam = ds.getClient().camera(flightId);
    setRawStream(cam.mediaStream);
    const off = cam.on("stream", setRawStream);
    // Bind a slot for this camera while it's on screen; release it on unmount /
    // camera switch. The data source refcounts, so several widgets showing the
    // same camera share one slot.
    ds.subscribeCamera(flightId);
    return () => {
      off();
      ds.unsubscribeCamera(flightId);
    };
  }, [flightId]);

  return rawStream;
}

/**
 * Opt-in delayed playout for a raw kerbcast `MediaStream` (M2 design §5 —
 * "media delay (kerbcast)"). Omit this argument entirely for the existing
 * LAN passthrough behaviour (zero regression, scenario 6) — see
 * `DelayedPlayoutResult`'s `"raw"` kind, the one retained live-video path
 * (cross-browser kerbcast video-delay design, 2026-07-16).
 *
 * A REAL per-frame delay (2026-07-15 fix, made cross-browser 2026-07-16):
 * every video frame read off the track is individually stamped with the
 * live interpolated capture UT and gated on the shared clock — see
 * `../frameDelay.ts` (main-thread backend, Chrome) and `../worker/`
 * (worker-hosted backend, Safari today / Firefox once its worker-side
 * Breakout Box lands — see the video-worker report for the per-engine
 * verification this dual-backend split rests on).
 */
export interface KerbcastStreamDelayOptions {
  /** THE delay clock — pass the SAME instance telemetry reads
   *  (`ViewClock` from `@ksp-gonogo/sitrep-client`, or an equivalent). Kept as
   *  a structural type here so this package never imports sitrep-client. */
  view: DelayClockLike;
  /** Capture-UT to stamp EACH captured video frame with — called once per
   *  frame the pipeline reads off the track, not once per stream
   *  reference. */
  captureUt(): number;
  /** The raw (un-interpolated) capture-clock sample backing `captureUt`.
   *  Only needed by the worker backend, which interpolates locally at
   *  frame-read time inside the worker rather than calling a main-thread
   *  closure per frame (Clock seam, "captureUt: same treatment"). Omit if
   *  the caller never expects the worker backend to be reachable (e.g. a
   *  test that only exercises the main-thread path) — the worker backend
   *  simply won't be attempted without it. */
  getCaptureSample?(): CaptureClockSample;
  /** Bumped (any change) to flush the buffer on a timeline reset — pass the
   *  session's epoch/reset counter. Omit if the caller doesn't model resets. */
  resetEpoch?: number;
  /** Frame-count cap forwarded to the pipeline — see `frameDelay.ts`'s
   *  module docstring for the default and rationale. */
  maxBufferedFrames?: number;
}

/**
 * `useDelayedPlayout`'s result — a discriminated union rather than
 * `MediaStream | null` (cross-browser kerbcast video-delay design,
 * 2026-07-16) so a caller can distinguish "still connecting" from
 * "genuinely can't be delayed here", which a bare nullable stream cannot:
 *
 * - `"raw"` — no `delay` options were supplied at all (the one retained
 *   live-video path — "there is genuinely nothing to delay", not a delay
 *   failure). `stream` may itself be `null` while the camera connects.
 * - `"connecting"` — delay WAS requested, but there's nothing to show yet:
 *   the raw stream hasn't arrived, or a pipeline build is in flight.
 * - `"delayed"` — a real per-frame delay pipeline is up; `stream` is its
 *   output.
 * - `"unavailable"` — delay was requested and expected, but no backend
 *   could build a pipeline here. Per decision 5 of the design doc, this is
 *   NEVER papered over with the live stream — the caller must render an
 *   explicit "can't delay" state instead (see `CameraFeed.tsx`).
 */
export type DelayedPlayoutResult =
  | { kind: "raw"; stream: MediaStream | null }
  | { kind: "connecting" }
  | { kind: "delayed"; stream: MediaStream }
  | { kind: "unavailable"; reason: string };

const RAW_NULL: DelayedPlayoutResult = { kind: "raw", stream: null };
const CONNECTING: DelayedPlayoutResult = { kind: "connecting" };

/**
 * Route a raw `MediaStream` through the real per-frame delay pipeline,
 * sharing the app's telemetry delay clock (M2 design §5). Without `delay`
 * (the default) this is a strict passthrough — it returns `{kind: "raw",
 * stream: raw}` unchanged, so the LAN case is bit-for-bit the old
 * behaviour, with NO pipeline spun up.
 *
 * With `delay`, THREE backends are tried in order (2026-07-16, encoded-transform
 * video-delay work — `local_docs/reports/encoded-video-delay-report.md`):
 *
 *  0. **Encoded transform on the receiver** (`attachEncodedWorkerFrameDelay`)
 *     — tried first when `getUplinkHandle("kerbcast")` can resolve an
 *     `RTCRtpReceiver` for `raw` (via `KerbcastDataSource.getReceiverForStream`)
 *     AND `RTCRtpScriptTransform` exists. Empirically confirmed cross-browser
 *     correct (Chromium/Firefox/WebKit, Phase 1 of that report) — the ONLY
 *     backend that can reach Firefox at all. Delays IN PLACE (no new track):
 *     on success the result's `stream` is `raw` itself, unchanged — the delay
 *     happens transparently upstream of decode.
 *  1. **Main-thread Breakout Box** (`isFrameDelaySupported()` /
 *     `createFrameDelayStream`) — Chrome, tried when (0) can't attach (no
 *     receiver resolvable — e.g. a test fixture, or a future non-`BrowserRTCTransport`
 *     transport — or the browser lacks `RTCRtpScriptTransform`).
 *  2. **Worker-hosted Breakout Box** (`createWorkerFrameDelayStream`) —
 *     tried only when (0) and (1) are both unavailable. Safari/WebKit
 *     supports this today (see `local_docs/reports/video-worker-report.md`
 *     for the per-engine breakdown backends 1/2's ordering rests on).
 *
 * If NO backend can build a pipeline, resolves `{kind: "unavailable",
 * reason}` — **never** the raw stream. The old silent
 * `setDelayedStream(raw)` fallback (and its one-time warning) is deleted;
 * "can't delay" is now a first-class, visible state the caller renders
 * explicitly (decision 5).
 */
export function useDelayedPlayout(
  raw: MediaStream | null,
  delay?: KerbcastStreamDelayOptions,
): DelayedPlayoutResult {
  const [result, setResult] = useState<DelayedPlayoutResult>(() =>
    delay ? CONNECTING : { kind: "raw", stream: raw },
  );
  const leaseRef = useRef<ReturnType<
    typeof sharedDelayedStreams.acquire
  > | null>(null);
  const view = delay?.view;
  const maxBufferedFrames = delay?.maxBufferedFrames;
  // Always-current handles so the effect below doesn't need `delay` itself
  // (a fresh object identity most renders) in its dependency array, and so the
  // contribution the shared cache reads always reflects THIS consumer's live
  // capture clock.
  const captureUtRef = useRef(delay?.captureUt);
  captureUtRef.current = delay?.captureUt;
  const getCaptureSampleRef = useRef(delay?.getCaptureSample);
  getCaptureSampleRef.current = delay?.getCaptureSample;

  // Attach to (or, as the first consumer, start) the SHARED per-camera
  // pipeline whenever the raw stream reference or the clock instance changes.
  // A `raw` change (camera switch, reconnect) releases the old camera's lease
  // and acquires the new one — no cross-camera frame bleed, and the last
  // consumer of the old track tears its pipeline down. Delay is a property of
  // the camera: N consumers of one track share ONE processor and one delayed
  // output (see `sharedDelayedStreams`).
  useEffect(() => {
    if (!view) {
      setResult(raw === null ? RAW_NULL : { kind: "raw", stream: raw });
      return;
    }
    if (!raw) {
      setResult(CONNECTING);
      return;
    }
    if (!captureUtRef.current) {
      // Delay was structurally requested (a `view` was passed) but the
      // caller has no capture clock yet — mirrors `useDelayedKerbcastStream`'s
      // own "no capture clock yet -> passthrough" case (old kerbcast
      // plugin/sidecar, or before the first ~1Hz sample): there is nothing
      // to stamp frames with, so this is the retained-live-path case, not
      // an "unavailable" failure.
      setResult({ kind: "raw", stream: raw });
      return;
    }

    const lease = sharedDelayedStreams.acquire(raw, (ctx) =>
      buildDelayedPipeline(raw, view, maxBufferedFrames, ctx),
    );
    leaseRef.current = lease;
    // Contribute THIS consumer's live capture clock. The build reads whichever
    // contributing lease is first-still-live, so the pipeline keeps stamping
    // correctly even after the consumer that built it unmounts.
    lease.setContribution({
      captureUt: () => captureUtRef.current?.() ?? 0,
      getCaptureSample: () =>
        getCaptureSampleRef.current?.() ?? NEUTRAL_CAPTURE_SAMPLE,
    });
    const sync = () => setResult(lease.get() ?? CONNECTING);
    const unsubscribe = lease.subscribe(sync);
    sync();

    return () => {
      unsubscribe();
      lease.release();
      leaseRef.current = null;
    };
  }, [raw, view, maxBufferedFrames]);

  // Timeline-reset: flush the shared buffer (drop stale pre-reset frames)
  // WITHOUT tearing down the pipeline — the track keeps flowing. Shared, so a
  // reset flushes for every consumer of this camera, which is correct: they
  // ride one buffer off one clock epoch.
  const resetEpoch = delay?.resetEpoch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetEpoch` is the intentional trigger-only dependency — the effect body doesn't read it, it just needs to re-fire flush() on every bump.
  useEffect(() => {
    leaseRef.current?.flush();
  }, [resetEpoch]);

  return result;
}

/**
 * Build ONE delayed pipeline for a camera track — the `build` function the
 * shared cache runs at most once per camera. Tries the three backends in the
 * documented order and returns a `BuiltDelayedStream` whose `result` is the
 * `DelayedPlayoutResult` every consumer of this camera then sees, plus the
 * `dispose`/`flush` handles the cache calls on last-release / timeline-reset.
 *
 * Reads the capture clock through `ctx.contribution()` (the first still-live
 * lease's), NOT a closure over any one consumer's refs — the pipeline outlives
 * whichever consumer built it, and a frozen capture UT would stamp frames
 * against a dead clock. `view` (the ONE `ViewClock`) is the same instance for
 * every consumer, so capturing it here is safe.
 *
 * NOT `async`: the sync backends (encoded, main-thread Breakout Box, and the
 * "unavailable" outcomes) return a `BuiltDelayedStream` synchronously so the
 * shared cache settles in the same tick — no spurious extra "connecting" frame,
 * matching the old direct-`setResult` timing. ONLY the worker backend returns a
 * Promise (it genuinely awaits `createWorkerFrameDelayStream`).
 */
function buildDelayedPipeline(
  raw: MediaStream,
  view: DelayClockLike,
  maxBufferedFrames: number | undefined,
  ctx: DelayedStreamBuildContext<CaptureContribution>,
):
  | BuiltDelayedStream<DelayedPlayoutResult>
  | Promise<BuiltDelayedStream<DelayedPlayoutResult>> {
  const onPipelineError = (err: unknown) => {
    logger.tag("kerbcast:frame-delay").warn("frame pipeline error", { err });
  };
  const captureUt = () => ctx.contribution()?.captureUt() ?? 0;
  const getCaptureSample = () =>
    ctx.contribution()?.getCaptureSample() ?? NEUTRAL_CAPTURE_SAMPLE;

  // Backend 0: encoded transform, attached directly to the RTCRtpReceiver
  // behind `raw` — see `useDelayedPlayout`'s module doc. `getReceiverForStream`
  // is called optionally (`?.`) because a data source under test may not
  // implement it at all (a fake registered via `registerUplinkHandle` in a unit
  // test, matching the "unknown methods degrade to undefined, never throw"
  // convention this module already follows elsewhere). One transform per
  // receiver — sharing at the source is what keeps that invariant.
  const ds = getUplinkHandle<KerbcastDataSource>("kerbcast");
  const receiver = ds?.getReceiverForStream?.(raw);
  if (receiver && typeof RTCRtpScriptTransform !== "undefined") {
    const encodedCapableView = view as DelayClockLike & {
      snapshot?(): unknown;
    };
    if (typeof encodedCapableView.snapshot === "function") {
      const encodedHandle = attachEncodedWorkerFrameDelay(receiver, {
        view: view as unknown as SnapshottableDelayClock,
        getCaptureSample,
        onError: onPipelineError,
      });
      if (encodedHandle) {
        // No new track: the delay happens in place on `raw`'s existing track,
        // upstream of decode — surface `raw` itself, unchanged.
        return {
          result: { kind: "delayed", stream: raw },
          dispose: encodedHandle.dispose,
          flush: encodedHandle.flush,
        };
      }
      // Falls through to backend 1/2 below — never a hard failure on its own
      // (a receiver resolving but the platform's RTCRtpScriptTransform
      // constructor still throwing is exactly the "try the next backend" case,
      // same as backends 1/2's own null-return handling).
    }
  }

  // Backend 1: Chrome's main-thread Breakout Box — tried when backend 0
  // couldn't attach.
  if (isFrameDelaySupported()) {
    let onErrorReason: string | null = null;
    const pipeline = createFrameDelayStream(raw, {
      view,
      captureUt,
      maxBufferedFrames,
      onError: (err) => {
        onErrorReason = String(err);
        onPipelineError(err);
      },
    });
    if (pipeline) {
      return {
        result: { kind: "delayed", stream: pipeline.stream },
        dispose: pipeline.dispose,
        flush: pipeline.flush,
      };
    }
    return {
      result: {
        kind: "unavailable",
        reason:
          onErrorReason ??
          "per-frame delay pipeline could not be built on this camera",
      },
    };
  }

  // Backend 2: worker-hosted Breakout Box — Safari today; Firefox once it
  // lands (feature-detected, see the module doc above).
  const snapshotCapableView = view as DelayClockLike & {
    snapshot?(): unknown;
  };
  if (typeof snapshotCapableView.snapshot !== "function") {
    return {
      result: {
        kind: "unavailable",
        reason:
          "this browser has no main-thread per-frame delay support, and the supplied clock does not support the worker backend (no snapshot())",
      },
    };
  }

  // The worker backend genuinely awaits — return its Promise so the cache
  // settles async ONLY for this path (every path above settled synchronously).
  return (async (): Promise<BuiltDelayedStream<DelayedPlayoutResult>> => {
    let workerErrorReason: string | null = null;
    const workerPipeline = await createWorkerFrameDelayStream(raw, {
      // Narrowed by the runtime `typeof snapshot === "function"` check just
      // above — `DelayClockLike` is deliberately narrower than
      // `SnapshottableDelayClock` (kerbcast never hard-depends on `snapshot()`
      // existing; only the worker backend needs it).
      view: view as unknown as SnapshottableDelayClock,
      getCaptureSample,
      maxBufferedFrames,
      onError: (err) => {
        workerErrorReason = String(err);
        onPipelineError(err);
      },
    });
    if (workerPipeline) {
      return {
        result: { kind: "delayed", stream: workerPipeline.stream },
        dispose: workerPipeline.dispose,
        flush: workerPipeline.flush,
      };
    }
    return {
      result: {
        kind: "unavailable",
        reason:
          workerErrorReason ??
          "no per-frame video delay backend is available in this browser",
      },
    };
  })();
}
