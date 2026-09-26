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
  /** The widget's required channels only; optional channels never gate. */
  channels?: readonly string[];
  children: ReactNode;
}

/**
 * The orchestrator's "can this widget render meaningfully now" gate, one
 * reason line in priority order: no telemetry host, an unhealthy Uplink owning
 * a required channel, then an unmet `requires` game context. With nothing to
 * check it adds no wrapper DOM.
 */
export function RequiresGuard({
  requires,
  channels,
  children,
}: RequiresGuardProps) {
  const hostDown = useTelemetryHostDown();
  const uplinkHealth = useUplinkHealthFor(channels ?? []);
  const ctx = useGameContext();

  // A channel-less widget has nothing a missing host can block.
  if (hostDown && channels && channels.length > 0) {
    return <GuardPlaceholder message={NO_TELEMETRY_HOST_MESSAGE} />;
  }

  if (uplinkHealth.status === "resolved" && uplinkHealth.state !== "healthy") {
    return (
      <GuardPlaceholder
        message={uplinkHealth.detail ?? `${uplinkHealth.ownerId}: unavailable`}
      />
    );
  }

  if (!requires || requires.length === 0) {
    return <>{children}</>;
  }

  // Without any game-context signal yet, gating would flash every widget on each refresh.
  if (!ctx.hasGameSignal) {
    return <>{children}</>;
  }

  for (const req of requires) {
    if (req === "flight" && !ctx.inFlight) {
      return (
        <GuardPlaceholder
          message="Vessel in flight required"
          hint={hintForScene(ctx.scene)}
        />
      );
    }
    if (req === "career" && !ctx.isCareerLike) {
      return (
        <GuardPlaceholder
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

/**
 * The one placeholder every orchestrator-side gate renders, since two gates
 * that look different read as two kinds of problem. It collapses to its own
 * height rather than holding the widget's size.
 */
export function GuardPlaceholder({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
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

export { DimmedOverlay };

function hintForScene(scene: string): string | undefined {
  switch (scene) {
    case "SpaceCenter":
      return "Launch a vessel to see this widget live.";
    case "Editor":
      return "Editor scene: vessel data unavailable.";
    case "TrackingStation":
      return "Switch to a vessel in the tracking station.";
    case "MainMenu":
      return "Load a save to begin.";
    default:
      return undefined;
  }
}
