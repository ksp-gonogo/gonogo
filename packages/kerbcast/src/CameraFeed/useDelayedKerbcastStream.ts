import { useViewClockOptional } from "@gonogo/sitrep-client";
import {
  useDelayedPlayout,
  useKerbcastStream,
} from "../hooks/useKerbcastStream";

/**
 * gonogo's stream source for the shared `CameraFeed`, injected via its
 * `useStream` seam (kerbcam SDK §3.4). It composes three already-tested
 * pieces without moving any of them into the SDK:
 *
 *   1. the SDK/data-source glue `useKerbcastStream` — the raw live `MediaStream`
 *      for the RESOLVED flightId (auto-latch / fallback already applied by the
 *      feed, so this hook never re-derives it);
 *   2. gonogo's `DelayedPlayoutBuffer` (via `useDelayedPlayout`);
 *   3. the ONE shared `ViewClock` telemetry reads (`useViewClockOptional`).
 *
 * Single-authority guarantee: `view` is the same `ViewClock` instance every
 * delay-consistent telemetry surface reads, and the buffer only releases on
 * that clock's `confirmedEdgeUt()` — so a media frame and a telemetry sample
 * stamped the same UT surface on the same clock crossing.
 *
 * Passthrough: with no `TelemetryProvider` in the tree (`view === undefined`)
 * the buffer is bypassed entirely — a strict LAN passthrough, unchanged. When
 * a provider IS present but the delay is zero, `confirmedEdgeUt()` tracks live
 * and a frame stamped at that edge releases immediately — also a passthrough.
 *
 * MUST be a stable module-scope reference (never redefined per render) and
 * passed consistently to `CameraFeed`, per the `useStream` rules-of-hooks
 * contract.
 *
 * PENDING a real per-frame/session capture-UT source: the kerbcast wire does
 * not yet carry a capture UT (§5.2), and sitrep-client exposes no live-UT /
 * session hook, so the current stream reference is stamped with the shared
 * clock's own `confirmedEdgeUt()`. That keeps the single-clock plumbing and
 * the seam fully wired while behaving as a passthrough today; once a capture
 * UT is available, only the `captureUt` closure below changes — the buffer,
 * the clock wiring and the `useStream` seam stay exactly as they are.
 */
export function useDelayedKerbcastStream(
  flightId: number | null,
): MediaStream | null {
  const raw = useKerbcastStream(flightId);
  const view = useViewClockOptional();
  return useDelayedPlayout(
    raw,
    view
      ? {
          view,
          // See the PENDING note above.
          captureUt: () => view.confirmedEdgeUt(),
        }
      : undefined,
  );
}
