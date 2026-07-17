import { useKerbcastClock } from "@ksp-gonogo/kerbcast-react";
import { logger } from "@ksp-gonogo/logger";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CaptureClockSample } from "../captureClock";
import { interpolateCaptureUt } from "../captureClock";
import {
  type DelayedPlayoutResult,
  useDelayedPlayout,
  useKerbcastStream,
} from "../hooks/useKerbcastStream";

// Re-exported for backward compat — `interpolateCaptureUt`/`CaptureClockSample`
// moved to `../captureClock.ts` (2026-07-16, cross-browser video-delay work)
// so the worker-hosted backend can share the exact same interpolation
// instead of forking it. See that module's doc.
export type { CaptureClockSample } from "../captureClock";
export { interpolateCaptureUt } from "../captureClock";

// ---------------------------------------------------------------------------
// Delayed-playout STATUS side channel (cross-browser kerbcast video-delay
// design, 2026-07-16). `useDelayedKerbcastStream` is called BY the kerbcam
// SDK's `useStream` seam, which constrains its return type to
// `MediaStream | null` (`CameraStreamHook` — see `kerbcast-react`'s
// `CameraFeed.d.ts`). That leaves no channel for `CameraFeed.tsx` (which
// does NOT call this hook itself — the SDK does, internally) to learn
// "delay was expected here but the pipeline couldn't be built", which it
// needs to render the explicit "delayed feed unavailable" state (decision
// 5 — never the live stream).
//
// Fix: this hook writes its OWN `DelayedPlayoutResult` into a tiny external
// store keyed by `flightId`, and `useDelayedPlaybackStatus` (below) reads it
// via `useSyncExternalStore` — the same "refcounted external resource,
// subscribe/notify" shape `KerbcastDataSource` and `PerfBudget` already use
// elsewhere in this codebase, just sized for a single in-memory value
// instead of a class. `CameraFeed.tsx` calls `useDelayedPlaybackStatus`
// directly (its own hook call, independent of the SDK's `useStream`
// invocation) — no second pipeline is built; this is read-only.
//
// Known limitation: keyed by `flightId`, so two feed widgets simultaneously
// showing the SAME camera share one status entry (last-write-wins). This
// mirrors a PRE-EXISTING limitation one layer down: `createFrameDelayStream`
// builds a fresh `MediaStreamTrackProcessor` per widget instance, and a
// `MediaStreamTrack` may have only one processor at a time — two delayed
// widgets on one camera were never independently supported. Not addressed
// here; flagged in the video-worker report.
// ---------------------------------------------------------------------------

interface StatusEntry {
  status: DelayedPlayoutResult;
  listeners: Set<() => void>;
}
const statusByFlightId = new Map<number, StatusEntry>();

function publishStatus(flightId: number, status: DelayedPlayoutResult): void {
  let entry = statusByFlightId.get(flightId);
  if (!entry) {
    entry = { status, listeners: new Set() };
    statusByFlightId.set(flightId, entry);
  } else {
    entry.status = status;
  }
  for (const cb of entry.listeners) cb();
}

function subscribeStatus(flightId: number, cb: () => void): () => void {
  let entry = statusByFlightId.get(flightId);
  if (!entry) {
    entry = { status: { kind: "connecting" }, listeners: new Set() };
    statusByFlightId.set(flightId, entry);
  }
  entry.listeners.add(cb);
  return () => {
    entry?.listeners.delete(cb);
  };
}

function getStatusSnapshot(flightId: number): DelayedPlayoutResult {
  return statusByFlightId.get(flightId)?.status ?? { kind: "connecting" };
}

const NO_FLIGHT_STATUS: DelayedPlayoutResult = { kind: "raw", stream: null };

/**
 * Reactive read of the delayed-playout status published by
 * `useDelayedKerbcastStream` for `flightId` — the side channel documented
 * above. `CameraFeed.tsx` uses this to decide whether to render the
 * explicit "delayed feed unavailable" state instead of the SDK's normal
 * feed. `null` `flightId` always reads `{kind: "raw", stream: null}` (no
 * camera resolved yet — nothing to be unavailable about).
 */
export function useDelayedPlaybackStatus(
  flightId: number | null,
): DelayedPlayoutResult {
  return useSyncExternalStore(
    (cb) => (flightId === null ? () => {} : subscribeStatus(flightId, cb)),
    () => (flightId === null ? NO_FLIGHT_STATUS : getStatusSnapshot(flightId)),
  );
}

/**
 * gonogo's stream source for the shared `CameraFeed`, injected via its
 * `useStream` seam (kerbcam SDK §3.4). It composes three already-tested
 * pieces without moving any of them into the SDK:
 *
 *   1. the SDK/data-source glue `useKerbcastStream` — the raw live `MediaStream`
 *      for the RESOLVED flightId (auto-latch / fallback already applied by the
 *      feed, so this hook never re-derives it);
 *   2. gonogo's `DelayedPlayoutBuffer` (via `useDelayedPlayout`);
 *   3. the ONE shared `ViewClock` telemetry reads (`useViewClockOptional`),
 *      plus the kerbcast mission-time capture clock (`useKerbcastClock`, SDK
 *      1.4.0) that tells us WHEN each frame was captured.
 *
 * Single-authority guarantee: `view` is the same `ViewClock` instance every
 * delay-consistent telemetry surface reads, and the buffer only releases a
 * frame once that clock's `confirmedEdgeUt()` sweeps past the frame's capture
 * UT — so a media frame and a telemetry sample stamped the same UT surface on
 * the same clock crossing.
 *
 * Passthrough (byte-for-byte live, unchanged) in two cases, both by feeding
 * `useDelayedPlayout` no delay config:
 *   - no `TelemetryProvider` in the tree (`view === undefined`) — the LAN case;
 *   - no capture clock yet (`captureUt == null` — old kerbcast plugin/sidecar,
 *     or before the first ~1Hz sample), so we never hold video without knowing
 *     when it was captured.
 *
 * When both are present, each arriving frame is stamped with the live capture
 * UT (the ~1Hz sample interpolated forward by warp rate) and released against
 * `confirmedEdgeUt()`. A `resetEpoch` bump (revert / quickload / scene reload)
 * flushes the buffer so it resyncs rather than waiting on a UT that will never
 * arrive.
 *
 * Adapts `useDelayedPlayout`'s discriminated `DelayedPlayoutResult` down to
 * the `MediaStream | null` the SDK's `useStream` seam requires — `"raw"` and
 * `"delayed"` surface their stream (possibly `null` for `"raw"` while the
 * camera connects); `"connecting"` and `"unavailable"` both surface `null`
 * (the SDK just shows its own connecting/no-signal look either way). The
 * full result — including `"unavailable"`'s reason — is separately
 * published for `CameraFeed.tsx` to read via `useDelayedPlaybackStatus`
 * (see this module's top-of-file doc), so "can't delay" gets its own
 * explicit UI rather than being indistinguishable from "still connecting".
 *
 * MUST be a stable module-scope reference (never redefined per render) and
 * passed consistently to `CameraFeed`, per the `useStream` rules-of-hooks
 * contract.
 */
export function useDelayedKerbcastStream(
  flightId: number | null,
): MediaStream | null {
  const raw = useKerbcastStream(flightId);
  const view = useViewClockOptional();
  const { captureUt, epoch, warpRate } = useKerbcastClock();

  // Latch each ~1Hz clock sample with the wall-clock instant we saw it, so the
  // per-frame `liveCaptureUt` can interpolate forward between samples. Kept in
  // a ref (not state) — the buffer reads it lazily at frame-stamp time, and we
  // don't want a re-render per sample.
  const sampleRef = useRef<CaptureClockSample>({
    ut: captureUt,
    warpRate,
    atMs: 0,
  });
  useEffect(() => {
    sampleRef.current = { ut: captureUt, warpRate, atMs: performance.now() };
    // Diagnostic: does the consumer's `useKerbcastClock` actually yield a
    // `captureUt`? Null here while the connected client logs advancing
    // `captureUt` would mean the path is starved downstream of the SDK client.
    // NOTE: this proves the CLOCK reaches the consumer — it does NOT by itself
    // prove a given frame was held/released correctly; that's `frameDelay.ts`'s
    // real per-frame pipeline (`useDelayedPlayout`), which this hook composes
    // below. `confirmedEdgeUt` is the only ViewClock method `ViewClockView`
    // exposes.
    logger.tag("kerbcast:clock").debug("consumer clock sample", {
      captureUt,
      warpRate,
      hasView: view !== undefined,
      edgeUt: view?.confirmedEdgeUt() ?? null,
    });
  }, [captureUt, warpRate, view]);

  const liveCaptureUt = useCallback(
    () => interpolateCaptureUt(sampleRef.current, performance.now()) ?? 0,
    [],
  );
  // The worker backend needs the RAW sample, not the interpolated value —
  // see `KerbcastStreamDelayOptions.getCaptureSample`'s doc.
  const getCaptureSample = useCallback(() => sampleRef.current, []);

  const result = useDelayedPlayout(
    raw,
    view && captureUt != null
      ? {
          view,
          captureUt: liveCaptureUt,
          getCaptureSample,
          resetEpoch: epoch,
        }
      : undefined,
  );

  useEffect(() => {
    if (flightId !== null) publishStatus(flightId, result);
  }, [flightId, result]);

  if (result.kind === "raw" || result.kind === "delayed") return result.stream;
  return null;
}
