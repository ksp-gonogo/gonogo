import {
  type ComponentRequirement,
  NO_TELEMETRY_HOST_MESSAGE,
  useGameContext,
  useTelemetryHostDown,
  useUplinkHealthFor,
} from "@ksp-gonogo/core";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import styled from "styled-components";

export interface RequiresGuardProps {
  requires?: readonly ComponentRequirement[];
  /**
   * The widget's declared REQUIRED `channels` (Uplink architecture spec
   * §3.2). When any of these resolves to a non-healthy owning Uplink (via
   * `useUplinkHealthFor`), the gate blocks with that Uplink's
   * `health.detail` — this check runs BEFORE the `requires` game-context
   * check, since there's no point reporting "needs flight scene" when the
   * widget's own data isn't flowing anyway. `optionalChannels` are
   * deliberately never passed here — they always render through.
   */
  channels?: readonly string[];
  children: ReactNode;
}

/**
 * Wraps a dashboard widget with the framework's unified "can this widget
 * render meaningfully now" gate — merges two independent checks into ONE
 * reason line, in priority order:
 *
 * 1. a REQUIRED `channels` topic's owning Uplink is unhealthy -> that
 *    Uplink's own `health.detail`.
 * 2. a `requires` game-context precondition (`flight`/`career`) is unmet ->
 *    the existing scene/career-mode message.
 *
 * No requirements/channels = pass-through (no wrapper DOM, no styling
 * drift). Used by the dashboard orchestrator (`GridItemContent`,
 * `MobileDashboard`, `PushedDashboardOverlay`) so per-widget code stays in
 * `registerComponent({ requires: [...], channels: [...] })` — widgets
 * don't import this file directly.
 */
export function RequiresGuard({
  requires,
  channels,
  children,
}: RequiresGuardProps) {
  const hostDown = useTelemetryHostDown();
  const uplinkHealth = useUplinkHealthFor(channels ?? []);
  const ctx = useGameContext();

  // Host-down outranks a per-uplink health reading: with no telemetry host
  // at all, "resolved: unhealthy" vs. "unresolved: still booting" is a
  // distinction without a difference — say so plainly instead. Only gates
  // when the widget actually declared REQUIRED channels; a channel-less
  // widget (e.g. a purely local Serial Devices control) has nothing to
  // block on here.
  if (hostDown && channels && channels.length > 0) {
    return <RequiresPlaceholder message={NO_TELEMETRY_HOST_MESSAGE} />;
  }

  if (uplinkHealth.status === "resolved" && uplinkHealth.state !== "healthy") {
    return (
      <RequiresPlaceholder
        message={uplinkHealth.detail ?? `${uplinkHealth.ownerId}: unavailable`}
      />
    );
  }

  if (!requires || requires.length === 0) {
    return <>{children}</>;
  }

  // Suppress the overlay until we have at least one game-context signal.
  // First page load has neither `kc.scene` nor `career.mode` populated;
  // dimming everything immediately would flash on every refresh while
  // the WS subscription warms up.
  if (!ctx.hasGameSignal) {
    return <>{children}</>;
  }

  // Find the first unmet requirement and use it to drive the message.
  // Order matters: `flight` checks first because it's the more common
  // gate; a career-only-but-not-flight widget would still want the
  // career message even if flight is also missing (a sandbox flight
  // can't satisfy a career requirement either way).
  //
  // We render a compact placeholder (not the dimmed children) when a
  // requirement is unmet. The previous behaviour was DimmedOverlay
  // around the widget's full content, which on first load (no
  // telemetry) showed an empty-but-tall card per widget — the dashboard
  // looked broken. The placeholder collapses to just the banner;
  // outer flex parents (Panel etc.) constrain to the natural content
  // height. Last-good telemetry isn't preserved across the gate, but
  // on first load there isn't any anyway.
  for (const req of requires) {
    if (req === "flight" && !ctx.inFlight) {
      return (
        <RequiresPlaceholder
          message="Vessel in flight required"
          hint={hintForScene(ctx.scene)}
        />
      );
    }
    if (req === "career" && !ctx.isCareerLike) {
      return (
        <RequiresPlaceholder
          message="Career or science save required"
          hint={
            ctx.careerMode === "SANDBOX"
              ? "Sandbox mode has no funds or science."
              : undefined
          }
        />
      );
    }
  }

  return <>{children}</>;
}

function RequiresPlaceholder({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  // Wrapped in DimmedOverlay-equivalent chrome but without any underlying
  // dimmed content. The flex parent (Panel) can collapse to the banner's
  // natural height rather than reserving the widget's default size for
  // an empty stub.
  return (
    <PlaceholderWrap role="status" aria-live="polite">
      <PlaceholderMessage>{message}</PlaceholderMessage>
      {hint && <PlaceholderHint>{hint}</PlaceholderHint>}
    </PlaceholderWrap>
  );
}

const PlaceholderWrap = styled.div`
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 12px;
  text-align: center;
  color: var(--color-text-faint);
`;

const PlaceholderMessage = styled.span`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const PlaceholderHint = styled.span`
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
`;

// Re-export DimmedOverlay binding so the existing ergonomic stays — older
// callers that explicitly wrapped their content in DimmedOverlay keep
// working. RequiresGuard no longer uses it internally.
export { DimmedOverlay };

function hintForScene(scene: string): string | undefined {
  switch (scene) {
    case "SpaceCenter":
      return "Launch a vessel to see this widget live.";
    case "Editor":
      return "Editor scene — vessel data unavailable.";
    case "TrackingStation":
      return "Switch to a vessel in the tracking station.";
    case "MainMenu":
      return "Load a save to begin.";
    default:
      return undefined;
  }
}
