import { type ComponentRequirement, useGameContext } from "@gonogo/core";
import { DimmedOverlay } from "@gonogo/ui";
import type { ReactNode } from "react";

export interface RequiresGuardProps {
  requires?: readonly ComponentRequirement[];
  children: ReactNode;
}

/**
 * Wraps a dashboard widget with a state-aware dim overlay when any of
 * its declared `requires` aren't met by the current game context. The
 * widget still renders normally underneath the dim layer — operators
 * see the layout and last-good telemetry but visibly de-emphasised,
 * with a banner explaining why.
 *
 * No requirements = pass-through (no wrapper DOM, no styling drift).
 *
 * Used by the dashboard orchestrator (`GridItemContent`, `MobileDashboard`)
 * so per-widget code stays in `registerComponent({ requires: [...] })`
 * — widgets don't import this file directly.
 */
export function RequiresGuard({ requires, children }: RequiresGuardProps) {
  const ctx = useGameContext();

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
  for (const req of requires) {
    if (req === "flight" && !ctx.inFlight) {
      return (
        <DimmedOverlay
          show={true}
          message="Vessel in flight required"
          hint={hintForScene(ctx.scene)}
        >
          {children}
        </DimmedOverlay>
      );
    }
    if (req === "career" && !ctx.isCareerLike) {
      return (
        <DimmedOverlay
          show={true}
          message="Career or science save required"
          hint={
            ctx.careerMode === "SANDBOX"
              ? "Sandbox mode has no funds or science."
              : undefined
          }
        >
          {children}
        </DimmedOverlay>
      );
    }
  }

  return <>{children}</>;
}

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
