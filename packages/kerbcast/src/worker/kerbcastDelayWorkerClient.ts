/**
 * Main-thread client for the shared kerbcast delay worker (cross-browser
 * kerbcast video-delay design, 2026-07-16). This is the Safari-today /
 * Firefox-once-it-lands backend — see `frameDelay.ts`'s module doc for the
 * full backend picture and `local_docs/reports/video-worker-report.md` for
 * the empirical per-engine verification this design rests on.
 *
 * One worker, lazily spun up on first use, shared across every camera feed
 * on the page (design doc, locked decision 2) — a camera switch posts a new
 * `createPipeline`/`dispose` pair, never a fresh `new Worker()`.
 *
 * `createWorkerFrameDelayStream` mirrors `createFrameDelayStream`'s
 * contract as closely as an inherently-async operation allows: it resolves
 * `null` (never throws, never rejects) whenever the pipeline can't be
 * built here — no `Worker` support, no video track, the worker rejected
 * construction, OR (the common case on Chrome/Firefox as of the
 * verification above) `postMessage(..., [track])` throws SYNCHRONOUSLY
 * because this engine doesn't support transferring a `MediaStreamTrack`
 * at all. The caller (`useDelayedPlayout`) treats a `null` resolution
 * exactly like the main-thread backend's `null` return — "can't delay ⇒
 * no video" (decision 5), never a live fallback.
 *
 * NOT unit-tested (see `kerbcastDelayWorker.ts`'s doc for why) — thin
 * message-passing glue over already-tested pieces, validated by the manual
 * cross-browser check.
 */

import type { ClockFormulaSnapshot } from "@ksp-gonogo/sitrep-client";
import type { CaptureClockSample } from "../captureClock";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import type { FrameDelayStream } from "../frameDelay";
import { startPacingTicker } from "../frameDelay";
import type {
  CreatePipelineMessage,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./kerbcastDelayWorker";

/** The wider clock capability the worker backend needs beyond
 *  `DelayClockLike` — a serializable snapshot of the formula inputs to
 *  forward at ~60Hz. `ViewClock` (the app's real clock) satisfies this
 *  structurally; kerbcast never imports `ViewClock` directly (same
 *  decoupling `DelayedPlayoutBuffer.ts` already follows). */
export interface SnapshottableDelayClock extends DelayClockLike {
  snapshot(): ClockFormulaSnapshot;
}

export interface CreateWorkerFrameDelayStreamOptions {
  view: SnapshottableDelayClock;
  /** Read fresh on every ~60Hz tick; forwarded to the worker only when it
   *  actually changed (reference inequality) — the low-rate capture clock
   *  updates ~1Hz, no need to resend an unchanged sample 60x/sec. */
  getCaptureSample(): CaptureClockSample;
  maxBufferedFrames?: number;
  maxPacingBacklogSeconds?: number;
  onError?(error: unknown): void;
}

const DEFAULT_MAX_PACING_BACKLOG_SECONDS = 0.5; // see frameDelay.ts's own default + rationale

let sharedWorker: Worker | null | undefined; // undefined = not attempted yet, null = attempt failed
let pipelineCounter = 0;

interface PendingReady {
  resolve(track: MediaStreamTrack): void;
  reject(reason: string): void;
}
const pendingReady = new Map<string, PendingReady>();
const nonFatalErrorHandlers = new Map<string, (reason: string) => void>();

function getSharedWorker(): Worker | null {
  if (sharedWorker !== undefined) return sharedWorker;
  if (typeof Worker === "undefined") {
    sharedWorker = null;
    return null;
  }
  try {
    const worker = new Worker(
      new URL("./kerbcastDelayWorker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.postMessage({
      type: "init",
      mainTimeOriginMs: performance.timeOrigin,
    } satisfies MainToWorkerMessage);
    worker.onmessage = (ev: MessageEvent<WorkerToMainMessage>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "pipelineReady":
          pendingReady.get(msg.pipelineId)?.resolve(msg.track);
          pendingReady.delete(msg.pipelineId);
          return;
        case "pipelineError":
          pendingReady.get(msg.pipelineId)?.reject(msg.reason);
          pendingReady.delete(msg.pipelineId);
          return;
        case "pipelineNonFatalError":
          nonFatalErrorHandlers.get(msg.pipelineId)?.(msg.reason);
          return;
      }
    };
    sharedWorker = worker;
    return worker;
  } catch {
    sharedWorker = null;
    return null;
  }
}

function post(
  worker: Worker,
  msg: MainToWorkerMessage,
  transfer?: Transferable[],
): void {
  worker.postMessage(msg, transfer ?? []);
}

/** Starts the ~60Hz loop posting `clockSnapshot` (worker-global, so every
 *  pipeline on the shared worker reads the same clock — matches the app's
 *  ONE real `ViewClock`) and `captureSample` (per-pipeline, only when the
 *  sample reference actually changed) for one pipeline. Returns a stop
 *  function. Shared by both backends this file exposes — narrowed to just
 *  the two members either needs, so `AttachEncodedFrameDelayOptions`
 *  satisfies it structurally without a nominal relationship to
 *  `CreateWorkerFrameDelayStreamOptions`. */
function startPipelineTicker(
  worker: Worker,
  pipelineId: string,
  opts: Pick<CreateWorkerFrameDelayStreamOptions, "view" | "getCaptureSample">,
): () => void {
  let lastSample: CaptureClockSample | null = null;
  return startPacingTicker(() => {
    post(worker, { type: "clockSnapshot", snapshot: opts.view.snapshot() });
    const sample = opts.getCaptureSample();
    if (sample !== lastSample) {
      lastSample = sample;
      post(worker, { type: "captureSample", pipelineId, sample });
    }
  });
}

/**
 * Attempt to build the worker-hosted pipeline for `raw`'s first video
 * track. See the module doc for the contract: resolves `null` (never
 * throws) on any failure to build, including the synchronous
 * `postMessage(..., [track])` transfer failure this task's verification
 * found on Chrome/Firefox.
 */
export async function createWorkerFrameDelayStream(
  raw: MediaStream,
  opts: CreateWorkerFrameDelayStreamOptions,
): Promise<FrameDelayStream | null> {
  // Check worker support BEFORE touching `raw` — cheap, synchronous, and
  // means a caller in a Worker-less environment never needs `raw` to be a
  // real MediaStream-shaped object at all (matters for tests exercising
  // this path with opaque stream tokens, same convention
  // `createFrameDelayStream`'s `isFrameDelaySupported()` guard follows).
  const worker = getSharedWorker();
  if (!worker) return null;

  const track = raw.getVideoTracks()[0];
  if (!track) return null;

  pipelineCounter += 1;
  const pipelineId = `kerbcast-delay-${pipelineCounter}`;

  const readyPromise = new Promise<MediaStreamTrack>((resolve, reject) => {
    pendingReady.set(pipelineId, { resolve, reject });
  });

  const createMsg: CreatePipelineMessage = {
    type: "createPipeline",
    pipelineId,
    track,
    maxBufferedFrames: opts.maxBufferedFrames,
    maxPacingBacklogSeconds:
      opts.maxPacingBacklogSeconds ?? DEFAULT_MAX_PACING_BACKLOG_SECONDS,
  };

  try {
    // The transfer list is what actually moves the track — a browser that
    // doesn't support transferring a MediaStreamTrack (Chrome/Firefox, per
    // this task's 2026-07-16 verification) throws HERE, synchronously,
    // before the worker ever sees the message.
    worker.postMessage(createMsg, [track]);
  } catch (err) {
    pendingReady.delete(pipelineId);
    opts.onError?.(err);
    return null;
  }

  let outputTrack: MediaStreamTrack;
  try {
    outputTrack = await readyPromise;
  } catch (reason) {
    opts.onError?.(new Error(String(reason)));
    return null;
  }

  nonFatalErrorHandlers.set(pipelineId, (reason) => {
    opts.onError?.(new Error(reason));
  });
  const stopTicker = startPipelineTicker(worker, pipelineId, opts);

  return {
    stream: new MediaStream([outputTrack]),
    dispose: () => {
      stopTicker();
      nonFatalErrorHandlers.delete(pipelineId);
      post(worker, { type: "dispose", pipelineId });
    },
    flush: () => {
      post(worker, { type: "flush", pipelineId });
    },
  };
}

// ---------------------------------------------------------------------------
// Encoded-transform backend (2026-07-16, `local_docs/reports/encoded-video-delay-report.md`).
// Empirically validated cross-browser (Chromium/Firefox/WebKit) in Phase 1
// of that report, gated on a real confirmedEdgeUt() computation. Reachable
// from the main-screen and station/broker camera path via
// `KerbcastDataSource.getReceiverForStream` — see that method's doc for the
// reconciliation of why this is wireable gonogo-side, no SDK change needed.
// ---------------------------------------------------------------------------

export interface AttachEncodedFrameDelayOptions {
  view: SnapshottableDelayClock;
  /** Read fresh on every ~60Hz tick — same contract as
   *  `CreateWorkerFrameDelayStreamOptions.getCaptureSample`. */
  getCaptureSample(): CaptureClockSample;
  /** Real byte cap — see `encodedFrameDelay.ts`'s `DEFAULT_MAX_BUFFERED_BYTES`. */
  maxBufferedBytes?: number;
  maxPacingBacklogSeconds?: number;
  onError?(error: unknown): void;
}

export interface EncodedFrameDelayHandle {
  /** Detach the transform (`receiver.transform = null`) and tear down this
   *  pipeline's worker-side state. Idempotent from the caller's
   *  perspective — safe to call once, matching every other backend's
   *  `dispose()` contract in this package. */
  dispose(): void;
  flush(): void;
}

/**
 * Attach the encoded-transform backend directly to `receiver`. UNLIKE
 * `createWorkerFrameDelayStream`, this is effectively SYNCHRONOUS and
 * produces no new stream: `receiver.transform = new
 * RTCRtpScriptTransform(worker, options)` either succeeds immediately
 * (this function returns a handle) or throws (caught here, reported via
 * `onError`, returns `null`) — there's no async "pipelineReady" handshake
 * to await, because attaching a script transform doesn't move any track;
 * `self.onrtctransform` on the worker side has no message to reply with
 * (see `kerbcastDelayWorker.ts`'s `handleRtcTransform` doc). The delay
 * happens transparently, upstream of decode, on the SAME track the caller
 * already has — the caller should keep using its existing `MediaStream`
 * reference (e.g. `raw`, unchanged) once this resolves non-null, not swap
 * to a new one.
 *
 * Resolves `null` (never throws) whenever the pipeline can't be attached
 * here — no `Worker` support, or the platform's `RTCRtpScriptTransform`
 * constructor itself threw (e.g. the receiver already has a transform, or
 * the engine's `RTCRtpScriptTransform` is absent — check
 * `typeof RTCRtpScriptTransform !== "undefined"` before calling if the
 * caller wants to skip the attempt instead of taking the throw+report
 * round trip). The caller treats a `null` resolution exactly like every
 * other backend's `null`/`unavailable` case (decision 5 — never a silent
 * live fallback).
 */
export function attachEncodedWorkerFrameDelay(
  receiver: RTCRtpReceiver,
  opts: AttachEncodedFrameDelayOptions,
): EncodedFrameDelayHandle | null {
  const worker = getSharedWorker();
  if (!worker) return null;

  pipelineCounter += 1;
  const pipelineId = `kerbcast-encoded-${pipelineCounter}`;

  try {
    receiver.transform = new RTCRtpScriptTransform(worker, {
      pipelineId,
      maxBufferedBytes: opts.maxBufferedBytes,
      maxPacingBacklogSeconds: opts.maxPacingBacklogSeconds,
    });
  } catch (err) {
    opts.onError?.(err);
    return null;
  }

  nonFatalErrorHandlers.set(pipelineId, (reason) => {
    opts.onError?.(new Error(reason));
  });
  const stopTicker = startPipelineTicker(worker, pipelineId, opts);

  return {
    dispose: () => {
      stopTicker();
      nonFatalErrorHandlers.delete(pipelineId);
      post(worker, { type: "dispose", pipelineId });
      receiver.transform = null;
    },
    flush: () => {
      post(worker, { type: "flush", pipelineId });
    },
  };
}
