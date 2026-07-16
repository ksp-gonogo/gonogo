import { getDataSource } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { useEffect, useRef, useState } from "react";
import type { CaptureClockSample } from "../captureClock";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import {
  createFrameDelayStream,
  type FrameDelayStream,
  isFrameDelaySupported,
} from "../frameDelay";
import type { KerbcastDataSource } from "../KerbcastDataSource";
import {
  attachEncodedWorkerFrameDelay,
  createWorkerFrameDelayStream,
  type SnapshottableDelayClock,
} from "../worker/kerbcastDelayWorkerClient";

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
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
    return ds?.getClient().camera(flightId).mediaStream ?? null;
  });

  useEffect(() => {
    if (flightId === null) {
      setRawStream(null);
      return;
    }
    const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
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
 *     — tried first when `getDataSource("kerbcast")` can resolve an
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
  const pipelineRef = useRef<FrameDelayStream | null>(null);
  const view = delay?.view;
  const maxBufferedFrames = delay?.maxBufferedFrames;
  // Always-current handles so the effect below doesn't need `delay` itself
  // (a fresh object identity most renders) in its dependency array.
  const captureUtRef = useRef(delay?.captureUt);
  captureUtRef.current = delay?.captureUt;
  const getCaptureSampleRef = useRef(delay?.getCaptureSample);
  getCaptureSampleRef.current = delay?.getCaptureSample;

  // Build/tear down the per-frame pipeline whenever the raw stream
  // reference or the clock instance changes. A `raw` change (camera switch,
  // reconnect) always gets a fresh pipeline reading the new track — no
  // cross-camera frame bleed, and no stale frame lingers past teardown.
  useEffect(() => {
    if (!view) {
      pipelineRef.current = null;
      setResult(raw === null ? RAW_NULL : { kind: "raw", stream: raw });
      return;
    }
    if (!raw) {
      pipelineRef.current = null;
      setResult(CONNECTING);
      return;
    }
    const captureUt = captureUtRef.current;
    if (!captureUt) {
      // Delay was structurally requested (a `view` was passed) but the
      // caller has no capture clock yet — mirrors `useDelayedKerbcastStream`'s
      // own "no capture clock yet -> passthrough" case (old kerbcast
      // plugin/sidecar, or before the first ~1Hz sample): there is nothing
      // to stamp frames with, so this is the retained-live-path case, not
      // an "unavailable" failure.
      pipelineRef.current = null;
      setResult({ kind: "raw", stream: raw });
      return;
    }

    let cancelled = false;
    setResult(CONNECTING);

    const onPipelineError = (err: unknown) => {
      logger.tag("kerbcast:frame-delay").warn("frame pipeline error", { err });
    };

    async function build() {
      // Backend 0: encoded transform, attached directly to the RTCRtpReceiver
      // behind `raw` — see the module doc above. `getReceiverForStream` is
      // called optionally (`?.`) because a data source under test may not
      // implement it at all (a fake registered via `registerDataSource` in
      // a unit test, matching the "unknown methods degrade to undefined,
      // never throw" convention this hook already follows elsewhere).
      const ds = getDataSource("kerbcast") as KerbcastDataSource | undefined;
      const receiver = ds?.getReceiverForStream?.(raw as MediaStream);
      if (receiver && typeof RTCRtpScriptTransform !== "undefined") {
        const encodedCapableView = view as DelayClockLike & {
          snapshot?(): unknown;
        };
        if (typeof encodedCapableView.snapshot === "function") {
          const encodedHandle = attachEncodedWorkerFrameDelay(receiver, {
            view: view as unknown as SnapshottableDelayClock,
            getCaptureSample: () =>
              getCaptureSampleRef.current?.() ?? {
                ut: null,
                warpRate: 1,
                atMs: 0,
              },
            onError: onPipelineError,
          });
          if (cancelled) {
            encodedHandle?.dispose();
            return;
          }
          if (encodedHandle) {
            // No new track: the delay happens in place on `raw`'s existing
            // track, upstream of decode — surface `raw` itself, unchanged.
            pipelineRef.current = {
              stream: raw as MediaStream,
              dispose: encodedHandle.dispose,
              flush: encodedHandle.flush,
            };
            setResult({ kind: "delayed", stream: raw as MediaStream });
            return;
          }
          // Falls through to backend 1/2 below — never a hard failure on
          // its own (a receiver resolving but the platform's
          // RTCRtpScriptTransform constructor still throwing is exactly
          // the "try the next backend" case, same as backends 1/2's own
          // null-return handling).
        }
      }

      // Backend 1: Chrome's main-thread Breakout Box — tried when backend 0
      // couldn't attach.
      if (isFrameDelaySupported()) {
        let onErrorReason: string | null = null;
        const pipeline = createFrameDelayStream(raw as MediaStream, {
          view: view as DelayClockLike,
          captureUt: () => captureUtRef.current?.() ?? 0,
          maxBufferedFrames,
          onError: (err) => {
            onErrorReason = String(err);
            onPipelineError(err);
          },
        });
        if (cancelled) {
          pipeline?.dispose();
          return;
        }
        if (pipeline) {
          pipelineRef.current = pipeline;
          setResult({ kind: "delayed", stream: pipeline.stream });
          return;
        }
        setResult({
          kind: "unavailable",
          reason:
            onErrorReason ??
            "per-frame delay pipeline could not be built on this camera",
        });
        return;
      }

      // Backend 2: worker-hosted Breakout Box — Safari today; Firefox once
      // it lands (feature-detected, see the module doc above).
      const snapshotCapableView = view as DelayClockLike & {
        snapshot?(): unknown;
      };
      if (typeof snapshotCapableView.snapshot !== "function") {
        if (!cancelled) {
          setResult({
            kind: "unavailable",
            reason:
              "this browser has no main-thread per-frame delay support, and the supplied clock does not support the worker backend (no snapshot())",
          });
        }
        return;
      }

      let workerErrorReason: string | null = null;
      const workerPipeline = await createWorkerFrameDelayStream(
        raw as MediaStream,
        {
          // Narrowed by the runtime `typeof snapshot === "function"` check
          // just above — `DelayClockLike` is deliberately narrower than
          // `SnapshottableDelayClock` (kerbcast never hard-depends on
          // `snapshot()` existing; only the worker backend needs it).
          view: view as unknown as SnapshottableDelayClock,
          getCaptureSample: () =>
            getCaptureSampleRef.current?.() ?? {
              ut: null,
              warpRate: 1,
              atMs: 0,
            },
          maxBufferedFrames,
          onError: (err) => {
            workerErrorReason = String(err);
            onPipelineError(err);
          },
        },
      );
      if (cancelled) {
        workerPipeline?.dispose();
        return;
      }
      if (workerPipeline) {
        pipelineRef.current = workerPipeline;
        setResult({ kind: "delayed", stream: workerPipeline.stream });
        return;
      }
      setResult({
        kind: "unavailable",
        reason:
          workerErrorReason ??
          "no per-frame video delay backend is available in this browser",
      });
    }

    void build();

    return () => {
      cancelled = true;
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, [raw, view, maxBufferedFrames]);

  // Timeline-reset: flush the buffer (drop stale pre-reset frames) WITHOUT
  // tearing down the pipeline — the track keeps flowing.
  const resetEpoch = delay?.resetEpoch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetEpoch` is the intentional trigger-only dependency — the effect body doesn't read it, it just needs to re-fire flush() on every bump.
  useEffect(() => {
    pipelineRef.current?.flush();
  }, [resetEpoch]);

  return result;
}
