/**
 * The shared worker's entry point — cross-browser kerbcast video-delay
 * design, 2026-07-16, "one long-lived worker; each feed is a pipeline keyed
 * by id" (locked decision 2). Deliberately THIN: everything it does routes
 * straight into already-unit-tested pieces —
 * `runFrameDelayPipeline`/`DelayedPlayoutBuffer` (unchanged, F1),
 * `createWorkerDelayClock` (`workerDelayClock.ts`), `createNowWall`
 * (`timeBase.ts`), `interpolateCaptureUt` (`../captureClock.ts`), and
 * `startPacingTicker` (`../frameDelay.ts`, shared with the main-thread
 * backend). This file itself is message plumbing only.
 *
 * NOT unit-tested: jsdom has neither real Workers nor WebCodecs (per this
 * task's brief), so there is no way to exercise `self.onmessage` / a real
 * `MediaStreamTrackProcessor` in vitest. Correctness here rests on (a) every
 * piece it calls being independently tested, and (b) the manual
 * cross-browser verification in `local_docs/reports/video-worker-report.md`
 * (2026-07-16) confirming the actual browser behaviour this file assumes:
 * Safari/WebKit transfers a `MediaStreamTrack` into a worker and supports
 * `MediaStreamTrackProcessor` + `VideoTrackGenerator` there; Chrome and
 * Firefox (as of that verification) do not support the transfer at all —
 * `postMessage(..., [track])` throws SYNCHRONOUSLY on the MAIN thread
 * before this file ever runs, which is exactly why `createPipeline` never
 * needs to handle "the transfer silently failed": if we're executing this
 * handler at all, the track objectively arrived.
 *
 * Message protocol (see `kerbcastDelayWorkerClient.ts` for the main-thread
 * side of each of these):
 *  - `init`            — once, at worker startup: reconciles wall-clock bases.
 *  - `clockSnapshot`    — ~60Hz, worker-global: the ONE shared ViewClock's
 *                          formula inputs (every pipeline reads the same
 *                          `WorkerDelayClock`, matching the app's ONE real
 *                          `ViewClock` instance).
 *  - `captureSample`    — per-pipeline, whenever that camera's low-rate
 *                          capture-clock sample changes.
 *  - `createPipeline`   — per-pipeline, carries the transferred input track.
 *  - `flush` / `dispose`— per-pipeline lifecycle control.
 *
 * Worker -> main:
 *  - `pipelineReady`         — success; carries the transferred output track.
 *  - `pipelineError`         — construction failed (feature absent, or the
 *                               processor/generator pair threw) — the
 *                               "can't delay -> no video" case (decision 5).
 *  - `pipelineNonFatalError` — a post-construction read/write rejection,
 *                               mirrors `runFrameDelayPipeline`'s `onError`.
 */

import type { ClockFormulaSnapshot } from "@ksp-gonogo/sitrep-client";
import type { CaptureClockSample } from "../captureClock";
import { interpolateCaptureUt } from "../captureClock";
import {
  type FrameDelayPipeline,
  runFrameDelayPipeline,
  startPacingTicker,
} from "../frameDelay";
import { createNowWall } from "./timeBase";
import {
  createWorkerDelayClock,
  type WorkerDelayClock,
} from "./workerDelayClock";

// --- Wire message shapes -----------------------------------------------

export interface InitMessage {
  type: "init";
  /** The main thread's `performance.timeOrigin` (ms) — see `timeBase.ts`. */
  mainTimeOriginMs: number;
}

export interface ClockSnapshotMessage {
  type: "clockSnapshot";
  snapshot: ClockFormulaSnapshot;
}

export interface CaptureSampleMessage {
  type: "captureSample";
  pipelineId: string;
  sample: CaptureClockSample;
}

export interface CreatePipelineMessage {
  type: "createPipeline";
  pipelineId: string;
  track: MediaStreamTrack;
  maxBufferedFrames?: number;
  maxPacingBacklogSeconds: number;
}

export interface FlushMessage {
  type: "flush";
  pipelineId: string;
}

export interface DisposePipelineMessage {
  type: "dispose";
  pipelineId: string;
}

export type MainToWorkerMessage =
  | InitMessage
  | ClockSnapshotMessage
  | CaptureSampleMessage
  | CreatePipelineMessage
  | FlushMessage
  | DisposePipelineMessage;

export interface PipelineReadyMessage {
  type: "pipelineReady";
  pipelineId: string;
  track: MediaStreamTrack;
}

export interface PipelineErrorMessage {
  type: "pipelineError";
  pipelineId: string;
  reason: string;
}

export interface PipelineNonFatalErrorMessage {
  type: "pipelineNonFatalError";
  pipelineId: string;
  reason: string;
}

export type WorkerToMainMessage =
  | PipelineReadyMessage
  | PipelineErrorMessage
  | PipelineNonFatalErrorMessage;

// --- Minimal worker-global surface --------------------------------------
// This package's shared tsconfig targets the default DOM lib (not
// "webworker" — the two are mutually exclusive libs, and swapping the
// whole package to "webworker" would break every non-worker file that
// touches Window-only globals). Rather than fork a second tsconfig just
// for this one file, cast the ambient `self` down to the narrow slice this
// file actually needs — the same "minimal ambient surface" spirit as
// `webcodecs-track-io.d.ts`.
interface WorkerGlobalSurface {
  postMessage(message: WorkerToMainMessage, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<MainToWorkerMessage>) => void) | null;
}
const workerSelf = self as unknown as WorkerGlobalSurface;

// --- State ---------------------------------------------------------------

let sharedClock: WorkerDelayClock | null = null;
/** Set once by `handleInit` — the SAME time-origin-corrected wall clock the
 *  shared `WorkerDelayClock` uses, reused for `captureUt` interpolation so
 *  both read the main thread's basis consistently (`sample.atMs` is a raw
 *  `performance.now()` reading taken ON the main thread). */
let nowWall: (() => number) | null = null;

interface PipelineEntry {
  pipeline: FrameDelayPipeline;
  captureSample: CaptureClockSample;
  stopPacingTicker: () => void;
}
const pipelines = new Map<string, PipelineEntry>();

const DEFAULT_MS = { ut: null, warpRate: 1, atMs: 0 } as const;

function nowWallMs(readNowWall: () => number): number {
  return readNowWall() * 1000;
}

/** Feature-detect the writer, standard shape first (`VideoTrackGenerator`)
 *  per the design doc's "Writer feature detection" — see
 *  `webcodecs-track-io.d.ts`. Returns the constructed generator's OWN
 *  writable/output-track pair, uniformly, regardless of which shape won. */
function buildWriter(): {
  writable: WritableStream<VideoFrame>;
  outputTrack: MediaStreamTrack;
} | null {
  if (typeof VideoTrackGenerator !== "undefined") {
    const gen = new VideoTrackGenerator();
    return { writable: gen.writable, outputTrack: gen.track };
  }
  if (typeof MediaStreamTrackGenerator !== "undefined") {
    const gen = new MediaStreamTrackGenerator({ kind: "video" });
    return { writable: gen.writable, outputTrack: gen };
  }
  return null;
}

function handleInit(msg: InitMessage): void {
  // `createNowWall` expects `localTimeOrigin - mainTimeOrigin` (see
  // `timeBase.ts`'s worked example) — this worker's own
  // `performance.timeOrigin` IS `localTimeOrigin`, `msg.mainTimeOriginMs` IS
  // `mainTimeOrigin`.
  const offsetMs = performance.timeOrigin - msg.mainTimeOriginMs;
  nowWall = createNowWall(offsetMs, () => performance.now());
  sharedClock = createWorkerDelayClock({ nowWall });
}

function handleClockSnapshot(msg: ClockSnapshotMessage): void {
  sharedClock?.applySnapshot(msg.snapshot);
}

function handleCaptureSample(msg: CaptureSampleMessage): void {
  const entry = pipelines.get(msg.pipelineId);
  if (entry) entry.captureSample = msg.sample;
}

function handleCreatePipeline(msg: CreatePipelineMessage): void {
  // Captured into locals immediately — `sharedClock`/`nowWall` are
  // module-level `let`s, so TS can't narrow them past the `buildWriter()`
  // call below; a plain synchronous WebWorker with a single message queue
  // means neither can actually change between this check and the `try`
  // block regardless.
  const clock = sharedClock;
  const clockNowWall = nowWall;
  if (!clock || !clockNowWall) {
    workerSelf.postMessage({
      type: "pipelineError",
      pipelineId: msg.pipelineId,
      reason: "worker clock not initialised (init message never arrived)",
    });
    return;
  }
  if (typeof MediaStreamTrackProcessor === "undefined") {
    workerSelf.postMessage({
      type: "pipelineError",
      pipelineId: msg.pipelineId,
      reason: "no MediaStreamTrackProcessor in this worker context",
    });
    return;
  }
  const writer = buildWriter();
  if (!writer) {
    workerSelf.postMessage({
      type: "pipelineError",
      pipelineId: msg.pipelineId,
      reason:
        "no VideoTrackGenerator/MediaStreamTrackGenerator in this worker context",
    });
    return;
  }

  try {
    const processor = new MediaStreamTrackProcessor({ track: msg.track });
    const entry: PipelineEntry = {
      // `pipeline` is filled in immediately below — TS needs SOME value
      // here since `captureUt` (passed to `runFrameDelayPipeline` before
      // `pipeline` exists) closes over `entry`, not the local `pipeline`
      // const, so it always reads the current sample even mid-construction.
      pipeline: null as unknown as FrameDelayPipeline,
      captureSample: DEFAULT_MS,
      stopPacingTicker: () => {},
    };
    pipelines.set(msg.pipelineId, entry);

    const pipeline = runFrameDelayPipeline<VideoFrame>({
      view: clock,
      // Same time-origin-corrected wall clock the shared clock itself uses
      // (see the module-level `nowWall` doc) — `sample.atMs` is a raw
      // main-thread `performance.now()` reading, so the comparison needs
      // to land on that same basis, not the worker's own uncorrected clock.
      captureUt: () =>
        interpolateCaptureUt(entry.captureSample, nowWallMs(clockNowWall)) ?? 0,
      maxBufferedFrames: msg.maxBufferedFrames,
      source: processor.readable.getReader(),
      sink: writer.writable.getWriter(),
      pacing: { maxBacklogSeconds: msg.maxPacingBacklogSeconds },
      onError: (err) => {
        workerSelf.postMessage({
          type: "pipelineNonFatalError",
          pipelineId: msg.pipelineId,
          reason: String(err),
        });
      },
    });
    entry.pipeline = pipeline;
    entry.stopPacingTicker = startPacingTicker(
      pipeline.tickPacing,
      clockNowWall,
    );

    workerSelf.postMessage(
      {
        type: "pipelineReady",
        pipelineId: msg.pipelineId,
        track: writer.outputTrack,
      },
      [writer.outputTrack],
    );
  } catch (err) {
    pipelines.delete(msg.pipelineId);
    workerSelf.postMessage({
      type: "pipelineError",
      pipelineId: msg.pipelineId,
      reason: String(err),
    });
  }
}

function handleFlush(msg: FlushMessage): void {
  pipelines.get(msg.pipelineId)?.pipeline.flush();
}

function handleDispose(msg: DisposePipelineMessage): void {
  const entry = pipelines.get(msg.pipelineId);
  if (!entry) return;
  entry.stopPacingTicker();
  entry.pipeline.dispose();
  pipelines.delete(msg.pipelineId);
}

workerSelf.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      handleInit(msg);
      return;
    case "clockSnapshot":
      handleClockSnapshot(msg);
      return;
    case "captureSample":
      handleCaptureSample(msg);
      return;
    case "createPipeline":
      handleCreatePipeline(msg);
      return;
    case "flush":
      handleFlush(msg);
      return;
    case "dispose":
      handleDispose(msg);
      return;
  }
};
