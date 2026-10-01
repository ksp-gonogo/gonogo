import {
  type ComponentRequirement,
  NO_TELEMETRY_HOST_MESSAGE,
  useGameContext,
  useTelemetryHostDown,
  useUplinkHealthFor,
} from "@ksp-gonogo/core";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import { Panel } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

export interface RequiresGuardProps {
  requires?: readonly ComponentRequirement[];
  /** The widget's required channels only; optional channels never gate. */
  channels?: readonly string[];
  /** The widget's name, kept as the panel heading while its body is refused. */
  title?: string;
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
  title,
  children,
}: RequiresGuardProps) {
  const hostDown = useTelemetryHostDown();
  const uplinkHealth = useUplinkHealthFor(channels ?? []);
  const ctx = useGameContext();

  // A channel-less widget has nothing a missing host can block.
  if (hostDown && channels && channels.length > 0) {
    return (
      <GuardPlaceholder title={title} message={NO_TELEMETRY_HOST_MESSAGE} />
    );
  }

  if (uplinkHealth.status === "resolved" && uplinkHealth.state !== "healthy") {
    return (
      <GuardPlaceholder
        title={title}
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
          title={title}
          message="Vessel in flight required"
          hint={hintForScene(ctx.scene)}
        />
      );
    }
    if (req === "career" && !ctx.isCareerLike) {
      return (
        <GuardPlaceholder
          title={title}
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
 * that look different read as two kinds of problem. It is the widget's own
 * panel, titled and inactive, so the tile keeps its place and says why.
 */
export function GuardPlaceholder({
  title,
  message,
  hint,
}: {
  title?: string;
  message: string;
  hint?: string;
}) {
  return <Panel panelTitle={title} inactive={{ reason: message, hint }} />;
}

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
