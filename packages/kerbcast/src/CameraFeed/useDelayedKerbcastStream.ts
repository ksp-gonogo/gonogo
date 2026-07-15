import { useKerbcastClock } from "@ksp-gonogo/kerbcast-react";
import { logger } from "@ksp-gonogo/logger";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { useCallback, useEffect, useRef } from "react";
import {
  useDelayedPlayout,
  useKerbcastStream,
} from "../hooks/useKerbcastStream";

/** A capture-clock sample: the last mission-time UT the sidecar reported for
 * the video, the warp rate at that sample, and the wall-clock instant (ms,
 * `performance.now()` basis) we observed it. */
export interface CaptureClockSample {
  /** KSP universal time (seconds) the video was captured at, or `null` when no clock is known. */
  ut: number | null;
  /** Time-warp multiplier at the sample, for forward interpolation. */
  warpRate: number;
  /** `performance.now()` ms when this sample was observed. */
  atMs: number;
}

/**
 * Interpolate the live capture-UT forward from a ~1Hz sample. The sidecar's
 * mission-time clock only updates ~once a second, so between samples we
 * advance it by wall-clock elapsed × the warp rate (UT runs `warpRate`× faster
 * than wall-clock under timewarp). Returns `null` when there's no clock.
 *
 * Pure + injectable `nowMs` so it unit-tests deterministically.
 */
export function interpolateCaptureUt(
  sample: CaptureClockSample,
  nowMs: number,
): number | null {
  if (sample.ut == null) return null;
  const elapsedSec = Math.max(0, (nowMs - sample.atMs) / 1000);
  return sample.ut + elapsedSec * (sample.warpRate || 1);
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
    // Diagnostic: what does the consumer's `useKerbcastClock` actually yield,
    // and how much delay is the ViewClock applying to it? `captureUt` null
    // while the connected client logs advancing `captureUt` would mean the
    // path is starved downstream of the SDK client (kerbcast's suspicion).
    // `utNow - edge` is the delay in seconds the buffer holds each frame by
    // (a frame stamped `captureUt` releases when `edge` sweeps past it), so
    // it directly answers "is the camera actually delayed, and by how much".
    logger.tag("kerbcast:clock").debug("consumer clock sample", {
      captureUt,
      warpRate,
      hasView: view !== undefined,
      utNow: view?.utNowEstimate() ?? null,
      edgeUt: view?.confirmedEdgeUt() ?? null,
      // Pure one-way signal delay, separate from the sample-cadence clamp in
      // `confirmedEdgeUt` — `utNow - edge` is `max(delaySeconds, sample lag)`,
      // so log `delaySeconds` too to tell a light-time hold from mere
      // telemetry-cadence certainty lag.
      delaySeconds: view?.delaySeconds() ?? null,
    });
  }, [captureUt, warpRate, view]);

  const liveCaptureUt = useCallback(
    () => interpolateCaptureUt(sampleRef.current, performance.now()) ?? 0,
    [],
  );

  return useDelayedPlayout(
    raw,
    view && captureUt != null
      ? { view, captureUt: liveCaptureUt, resetEpoch: epoch }
      : undefined,
  );
}
