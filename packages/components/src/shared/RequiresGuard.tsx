import {
  type ComponentRequirement,
  NO_TELEMETRY_HOST_MESSAGE,
  useGameContext,
  useTelemetryHostDown,
  useUplinkHealthFor,
} from "@ksp-gonogo/core";
import { useClaimCapability } from "@ksp-gonogo/sitrep-sdk/spine";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import {
  Cluster,
  LockMark,
  LockScope,
  type LockSummary,
  Panel,
  Section,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

export interface RequiresGuardProps {
  requires?: readonly ComponentRequirement[];
  /** The widget's required channels only; optional channels never gate. */
  channels?: readonly string[];
  /** The widget's name, kept as the panel heading while its body is refused. */
  title?: string;
  /**
   * Set while the widget shows its tiny form: a lock then draws as the compact
   * mark under this heading, since the full notice does not fit a tiny tile.
   */
  compact?: { title: string };
  children: ReactNode;
}

/**
 * The orchestrator's "can this widget render meaningfully now" gate, one
 * reason line in priority order: no telemetry host, a capability this save has
 * not unlocked, an unhealthy Uplink owning a required channel, then an unmet
 * `requires` game context. With nothing to check it adds no wrapper DOM.
 *
 * The order is the nesting: the host check sits outside the widget's lock
 * scope, and the health and game-context checks inside it. Each declared
 * channel is claimed beside the body, so a widget the game-context check is
 * hiding still shows a lock it would meet; a read or command hook in the
 * widget's own body, outside any `Section`, locks the whole widget.
 */
export function RequiresGuard({
  requires,
  channels,
  title,
  compact,
  children,
}: RequiresGuardProps) {
  const hostDown = useTelemetryHostDown();
  // A channel-less widget has nothing a missing host can block.
  if (hostDown && channels && channels.length > 0) {
    return (
      <GuardPlaceholder title={title} message={NO_TELEMETRY_HOST_MESSAGE} />
    );
  }

  return (
    <LockScope
      fallback={(lock) =>
        compact ? (
          <TinyLockPlaceholder title={compact.title} lock={lock} />
        ) : (
          <GuardPlaceholder
            title={title}
            message={lock.reason}
            hint={lock.hint}
          />
        )
      }
    >
      {channels?.map((topic) => (
        <ChannelClaim key={topic} topic={topic} />
      ))}
      <ReadinessGate requires={requires} channels={channels} title={title}>
        {children}
      </ReadinessGate>
    </LockScope>
  );
}

/** Claims one declared channel with the widget's scope, drawing nothing. */
function ChannelClaim({ topic }: { topic: string }) {
  useClaimCapability("topic", topic);
  return null;
}

/** The health and game-context half of {@link RequiresGuard}, inside its lock scope. */
function ReadinessGate({
  requires,
  channels,
  title,
  children,
}: RequiresGuardProps) {
  const uplinkHealth = useUplinkHealthFor(channels ?? []);
  const ctx = useGameContext();

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

/** A lock in a tiny tile: the tiny heading over the compact mark, in the frame the tiny form draws in. */
function TinyLockPlaceholder({
  title,
  lock,
}: {
  title: string;
  lock: LockSummary;
}) {
  return (
    <Panel
      panelTitle={title}
      fitToSize
      hoverTitle
      sections={
        <Section full>
          <Cluster justify="center">
            <LockMark lock={lock} />
          </Cluster>
        </Section>
      }
    />
  );
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
