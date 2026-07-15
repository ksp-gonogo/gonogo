import { getDataSource } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { useEffect, useRef, useState } from "react";
import type { DelayClockLike } from "../DelayedPlayoutBuffer";
import { createFrameDelayStream, type FrameDelayStream } from "../frameDelay";
import type { KerbcastDataSource } from "../KerbcastDataSource";

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
 * LAN passthrough behaviour (zero regression, scenario 6).
 *
 * A REAL per-frame delay (2026-07-15 fix): every video frame read off the
 * track is individually stamped with the live interpolated capture UT and
 * gated on the shared clock — see `../frameDelay.ts`. This replaced an
 * earlier design that stamped once per `MediaStream` *reference* (only a
 * camera switch/reconnect was delayed; ongoing motion inside a stream
 * played live) — see the memory `project_camera_video_delay_not_implemented`
 * for the now-fixed history.
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
  /** Bumped (any change) to flush the buffer on a timeline reset — pass the
   *  session's epoch/reset counter. Omit if the caller doesn't model resets. */
  resetEpoch?: number;
  /** Frame-count cap forwarded to the pipeline — see `frameDelay.ts`'s
   *  module docstring for the default and rationale. */
  maxBufferedFrames?: number;
}

/**
 * Route a raw `MediaStream` through the real per-frame delay pipeline
 * (`../frameDelay.ts`), sharing the app's telemetry delay clock (M2 design
 * §5). Without `delay` (the default) this is a strict passthrough — it
 * returns `raw` unchanged, so the LAN case is bit-for-bit the old
 * behaviour, with NO pipeline spun up. With `delay`, each frame only
 * releases once `view.confirmedEdgeUt()` reaches its stamped capture UT —
 * never on `arrival + delay` — so a media frame and a telemetry sample
 * stamped the same UT surface at the same clock crossing (the
 * single-authority guarantee).
 *
 * Falls back to live passthrough (never a black feed) when the browser
 * lacks the WebCodecs track-IO APIs the pipeline needs, or `raw` has no
 * video track — flagged via a one-time warning log, not a silent drop; see
 * `frameDelay.ts`'s `isFrameDelaySupported`.
 */
export function useDelayedPlayout(
  raw: MediaStream | null,
  delay?: KerbcastStreamDelayOptions,
): MediaStream | null {
  const [delayedStream, setDelayedStream] = useState<MediaStream | null>(null);
  const pipelineRef = useRef<FrameDelayStream | null>(null);
  const view = delay?.view;
  const maxBufferedFrames = delay?.maxBufferedFrames;
  // Always-current handle so the effect below doesn't need `delay` itself
  // (a fresh object identity most renders) in its dependency array.
  const captureUtRef = useRef(delay?.captureUt);
  captureUtRef.current = delay?.captureUt;
  // Warn once per hook lifetime, not once per unsupported render — avoids
  // log spam while an undelayable feed sits open.
  const warnedUnsupportedRef = useRef(false);

  // Build/tear down the per-frame pipeline whenever the raw stream
  // reference or the clock instance changes. A `raw` change (camera switch,
  // reconnect) always gets a fresh pipeline reading the new track — no
  // cross-camera frame bleed, and no stale frame lingers past teardown.
  useEffect(() => {
    if (!view || !raw) {
      pipelineRef.current = null;
      setDelayedStream(null);
      return;
    }
    const captureUt = captureUtRef.current;
    if (!captureUt) {
      pipelineRef.current = null;
      setDelayedStream(null);
      return;
    }

    const pipeline = createFrameDelayStream(raw, {
      view,
      captureUt: () => captureUtRef.current?.() ?? 0,
      maxBufferedFrames,
      onError: (err) => {
        logger
          .tag("kerbcast:frame-delay")
          .warn("frame pipeline error", { err });
      },
    });

    if (!pipeline) {
      pipelineRef.current = null;
      if (!warnedUnsupportedRef.current) {
        warnedUnsupportedRef.current = true;
        logger
          .tag("kerbcast:frame-delay")
          .warn(
            "per-frame video delay could not be built here (no MediaStreamTrackProcessor/Generator, no video track, or pipeline construction failed) — falling back to live passthrough for the camera feed",
          );
      }
      // Flagged, not silent: no delay is possible here, so show the feed
      // live rather than black it out.
      setDelayedStream(raw);
      return;
    }

    pipelineRef.current = pipeline;
    // Set ONCE per pipeline build, not per frame: `pipeline.stream` is a
    // stable `MediaStream` wrapping the generator's output track, which
    // keeps updating on its own as the pump loop writes released frames to
    // it — the same way any live `<video srcObject>` renders a continuously
    // updating WebRTC track. No further React state churn per frame.
    setDelayedStream(pipeline.stream);

    return () => {
      pipeline.dispose();
      if (pipelineRef.current === pipeline) pipelineRef.current = null;
      setDelayedStream(null);
    };
  }, [raw, view, maxBufferedFrames]);

  // Timeline-reset: flush the buffer (drop stale pre-reset frames) WITHOUT
  // tearing down the pipeline — the track keeps flowing.
  const resetEpoch = delay?.resetEpoch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetEpoch` is the intentional trigger-only dependency — the effect body doesn't read it, it just needs to re-fire flush() on every bump.
  useEffect(() => {
    pipelineRef.current?.flush();
  }, [resetEpoch]);

  return delay ? delayedStream : raw;
}
