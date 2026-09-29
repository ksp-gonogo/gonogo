import {
  type ComponentRequirement,
  NO_TELEMETRY_HOST_MESSAGE,
  useGameContext,
  useTelemetryHostDown,
  useUplinkHealthFor,
} from "@ksp-gonogo/core";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import { ReadoutCaption, Stack, Text } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";

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
    <Stack
      gap="caption"
      style={PLACEHOLDER_STYLE}
      role="status"
      aria-live="polite"
    >
      <ReadoutCaption style={MESSAGE_STYLE}>{message}</ReadoutCaption>
      {hint && (
        <Text level="faint" style={HINT_STYLE}>
          {hint}
        </Text>
      )}
    </Stack>
  );
}

const PLACEHOLDER_STYLE: CSSProperties = {
  flex: "0 1 auto",
  minHeight: 0,
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "var(--inset-refusal)",
};

const MESSAGE_STYLE: CSSProperties = {
  fontWeight: 600,
  letterSpacing: "0.1em",
};

const HINT_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.04em",
};

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
