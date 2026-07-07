import { getDataSource } from "@gonogo/core";
import { useEffect, useRef, useState } from "react";
import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
} from "../DelayedPlayoutBuffer";
import type { KerbcastDataSource } from "../KerbcastDataSource";

const DEFAULT_MAX_BUFFERED_BYTES = 64;

/**
 * Opt-in delayed playout for {@link useKerbcastStream} (M2 design §5 —
 * "media delay (kerbcast)"). Omit this argument entirely for the existing
 * LAN passthrough behaviour (zero regression, scenario 6).
 *
 * The kerbcast wire protocol doesn't yet carry a real per-frame capture-UT
 * stamp (that's a kerbcast-SDK-side add, §5.2, out of scope for this
 * package) — so today each new `MediaStream` reference the SDK hands back
 * (a camera switch, a reconnect) is treated as one keyframe stamped with
 * `captureUt()`. That's coarser than true per-video-frame delay, but it's
 * the honest, currently-available granularity: it correctly delays *when a
 * stream becomes visible* against the shared clock, which is what keeps a
 * camera switch in sync with the telemetry it's shown alongside.
 */
export interface KerbcastStreamDelayOptions {
  /** THE delay clock — pass the SAME instance telemetry reads
   *  (`ViewClock` from `@gonogo/sitrep-client`, or an equivalent). Kept as
   *  a structural type here so this package never imports sitrep-client. */
  view: DelayClockLike;
  /** Capture-UT to stamp the current stream reference with. */
  captureUt(): number;
  /** Bumped (any change) to flush the buffer on a timeline reset — pass the
   *  session's epoch/reset counter. Omit if the caller doesn't model resets. */
  resetEpoch?: number;
  maxBufferedBytes?: number;
}

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
 * Pass `delay` to route the stream through a {@link DelayedPlayoutBuffer}
 * sharing the app's telemetry delay clock (M2 design §5). Without it (the
 * default) the hook is unchanged — a strict LAN passthrough.
 */
export function useKerbcastStream(
  flightId: number | null,
  delay?: KerbcastStreamDelayOptions,
): MediaStream | null {
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

  // -- Optional delayed playout ------------------------------------------
  const [delayedStream, setDelayedStream] = useState<MediaStream | null>(null);
  const bufferRef = useRef<DelayedPlayoutBuffer<MediaStream> | null>(null);
  const view = delay?.view;
  const maxBufferedBytes =
    delay?.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  // Always-current handle so the push effect below doesn't need `delay`
  // itself (a fresh object identity most renders) in its dependency array.
  const captureUtRef = useRef(delay?.captureUt);
  captureUtRef.current = delay?.captureUt;

  // Build/tear down the buffer whenever the clock instance (or its cap)
  // changes. Callers should pass a stable `view` (e.g. memoised).
  useEffect(() => {
    if (!view) return;
    const buffer = new DelayedPlayoutBuffer<MediaStream>({
      view,
      onRelease: (frame) => setDelayedStream(frame.data ?? null),
      maxBufferedBytes,
    });
    bufferRef.current = buffer;
    return () => {
      buffer.dispose();
      bufferRef.current = null;
      setDelayedStream(null);
    };
  }, [view, maxBufferedBytes]);

  // Push each new raw stream reference in as one keyframe, stamped with the
  // caller-provided capture UT.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` is needed even though the body only reads `bufferRef` — a `view` change (re)builds the buffer in the effect above, and this must re-push the already-current rawStream into that fresh buffer instead of waiting on the next stream event.
  useEffect(() => {
    const captureUt = captureUtRef.current;
    if (!captureUt || !bufferRef.current || rawStream === null) return;
    bufferRef.current.push({
      ut: captureUt(),
      keyframe: true,
      data: rawStream,
    });
  }, [rawStream, view]);

  // Timeline-reset: flush whatever's buffered + emit the resync marker.
  const resetEpoch = delay?.resetEpoch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetEpoch` is the intentional trigger-only dependency — the effect body doesn't read it, it just needs to re-fire flush() on every bump.
  useEffect(() => {
    bufferRef.current?.flush();
  }, [resetEpoch]);

  return delay ? delayedStream : rawStream;
}
