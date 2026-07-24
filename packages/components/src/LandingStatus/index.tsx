import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useActionInput,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  useCommand,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { CommsDelaySource } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline, StreamStatusBadge } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  EmptyState,
  formatDuration,
  Grid,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ReadoutCaption,
  ScrollArea,
  Section,
  SectionTitle,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { deriveBoard } from "./board";
import { CommitLayer } from "./CommitLayer";
import { deriveDelayClocks } from "./clocks";
import { DescentScope } from "./DescentScope";
import { solveSuicideBurn } from "./solveLanding";

// Empty config — kept for forward-compat with the old widget's config slot.
type LandingStatusConfig = Record<string, never>;

/**
 * Props for `landing-status.badges` — the widget's BROAD escape-hatch slot,
 * rendered in the header row next to the title. Preserved verbatim from the
 * predecessor so existing augment bindings keep working across the reboot.
 */
export interface LandingStatusBadgesContext {
  /** Body being landed on (`vessel.state.parentBodyName`), when known. */
  bodyName: string | null;
  /** Whether that body has an atmosphere (drives the vacuum/atmospheric split). */
  atmospheric: boolean;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "landing-status.badges": LandingStatusBadgesContext;
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

const landingActions = [
  {
    id: "toggle-gear",
    label: "Toggle gear",
    accepts: ["button"],
    description: "Deploys or retracts the landing gear.",
  },
  {
    id: "toggle-brakes",
    label: "Toggle brakes",
    accepts: ["button"],
    description: "Toggles the wheel brakes.",
  },
] as const satisfies readonly ActionDefinition[];
export type LandingActions = typeof landingActions;

// ── Formatting ───────────────────────────────────────────────────────────────

function formatMps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 10) return `${v.toFixed(2)} m/s`;
  if (Math.abs(v) < 100) return `${v.toFixed(1)} m/s`;
  return `${v.toFixed(0)} m/s`;
}

function formatMeters(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (Math.abs(m) >= 10_000) return `${(m / 1000).toFixed(1)} km`;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function formatDv(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(0)} m/s`;
}

/**
 * Read the one-way delay off `comms.delay`. Mirrors `delay-authority.ts`'s
 * `readOneWaySeconds` (None => 0, malformed => 0) but returns `null` when the
 * payload has not arrived at all, so the regime banner can honestly say the
 * link state is unknown rather than fabricating a live (zero-delay) reading.
 */
function readOneWaySeconds(
  delay: { source?: number; oneWaySeconds?: number } | undefined,
): number | null {
  if (!delay) return null;
  if (delay.source === CommsDelaySource.None) return 0;
  const s = delay.oneWaySeconds;
  return typeof s === "number" && Number.isFinite(s) && s >= 0 ? s : 0;
}

/** A labelled value row inside a two-column readout grid. */
function Field({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "accent" | "default" | "muted";
}) {
  return (
    <>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Value tone={tone ?? "default"}>{children}</Value>
    </>
  );
}

const DESCENT_HISTORY_MAX = 60;

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const vs = useStream<VesselState>("vessel.state");
  const bodyName = vs?.parentBodyName ?? undefined;
  const body = bodyName ? getBody(bodyName) : undefined;
  const atmospheric = body?.hasAtmosphere ?? false;

  const flight = useTelemetry("vessel.flight");
  const surface = useTelemetry("vessel.surface");
  const propulsion = useTelemetry("vessel.propulsion");
  const orbit = useTelemetry("vessel.orbit");
  const control = useTelemetry("vessel.control");
  const summary = useTelemetry("dv.summary");
  const commsDelay = useTelemetry("comms.delay");

  // Burn datum: the vessel's LOWEST point above terrain. Falls back to the CoM
  // radar altitude with a visible note when `vessel.surface` is nulled (Orbiting
  // / Escaping capture guard).
  const surfaceHeight = surface?.heightFromTerrain;
  const heightFromTerrain = surfaceHeight ?? flight?.altitudeTerrain;
  const usingComDatum = surfaceHeight == null && heightFromTerrain != null;

  const solution = solveSuicideBurn({
    heightFromTerrain,
    altitudeAsl: flight?.altitudeAsl,
    verticalSpeed: flight?.verticalSpeed,
    surfaceSpeed: flight?.surfaceSpeed,
    mu: orbit?.mu,
    bodyRadius: body?.radius,
    availableThrust: propulsion?.availableThrust,
    totalMass: propulsion?.totalMass,
  });

  const oneWaySeconds = readOneWaySeconds(commsDelay);
  const clocks = deriveDelayClocks({
    oneWaySeconds,
    suicideBurnCountdown: solution.suicideBurnCountdown,
    timeToImpact: solution.timeToImpact,
  });

  const availableDv = summary?.totalDvActual ?? summary?.totalDvVac;
  const requiredDv = solution.burnDeltaV;
  const affordable =
    requiredDv != null && availableDv != null
      ? requiredDv <= availableDv
      : null;

  const twr =
    solution.maxAccel != null &&
    solution.gravity != null &&
    solution.gravity > 0
      ? solution.maxAccel / solution.gravity
      : null;

  const gearCmd = useCommand("vessel.control.setGear");
  const brakesCmd = useCommand("vessel.control.setBrakes");
  const gearOn = control?.gear;
  const brakesOn = control?.brakes;
  const toggleGear = () =>
    void gearCmd.send(
      { enabled: !gearOn },
      { label: gearOn ? "Retract gear" : "Deploy gear" },
    );
  const toggleBrakes = () =>
    void brakesCmd.send(
      { enabled: !brakesOn },
      { label: brakesOn ? "Release brakes" : "Set brakes" },
    );

  useActionInput<LandingActions>({
    "toggle-gear": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      toggleGear();
      return { gear: !gearOn };
    },
    "toggle-brakes": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      toggleBrakes();
      return { brakes: !brakesOn };
    },
  });

  const streamStatus = useDataStreamStatus("data", "v.heightFromTerrain");

  const board = deriveBoard({ solutionState: solution.state, atmospheric });

  // Descent-rate trend — a bounded history of vertical speed, so a developing
  // over-speed reads as a trend not a single tick. Appended after render.
  const [descentHistory, setDescentHistory] = useState<number[]>([]);
  const currentVs = flight?.verticalSpeed;
  useEffect(() => {
    if (currentVs == null || !Number.isFinite(currentVs)) return;
    setDescentHistory((h) => {
      const next = [...h, currentVs];
      return next.length > DESCENT_HISTORY_MAX
        ? next.slice(next.length - DESCENT_HISTORY_MAX)
        : next;
    });
  }, [currentVs]);

  const badgesContext: LandingStatusBadgesContext = {
    bodyName: bodyName ?? null,
    atmospheric,
  };

  const live = clocks.regime === "live" || clocks.regime === "no-path";
  const showScope = (w ?? 8) >= 6;
  // The DescentScope only renders for a solved vacuum descent at a wide size; it
  // carries the AGL ladder + velocity vector. Everywhere else (small size, or an
  // atmospheric / no-solution board) fall back to the plain velocity + height
  // readouts, which are drag-independent and always valid.
  const scopeShown = board === "vacuum-solved" && showScope;

  return (
    <Panel>
      <Cluster>
        <PanelTitle>LANDING</PanelTitle>
        <AugmentSlot name="landing-status.badges" props={badgesContext} />
        <StreamStatusBadge status={streamStatus} />
      </Cluster>
      {bodyName !== undefined && (
        <PanelSubtitle>
          {bodyName}
          {atmospheric ? " · atmospheric" : " · vacuum"}
        </PanelSubtitle>
      )}

      {board === "not-descending" ? (
        <EmptyState>No landing in progress</EmptyState>
      ) : (
        <ScrollArea>
          <Section>
            <CommitLayer
              regime={clocks.regime}
              roundTripSeconds={clocks.roundTripSeconds}
              live={live}
              suicideBurnCountdown={solution.suicideBurnCountdown}
              commitInSeconds={clocks.commitInSeconds}
              committed={clocks.committed}
              blindInSeconds={clocks.blindInSeconds}
              blind={clocks.blind}
              gear={{
                on: gearOn,
                phase: gearCmd.status.phase,
                onToggle: toggleGear,
              }}
              brakes={{
                on: brakesOn,
                phase: brakesCmd.status.phase,
                onToggle: toggleBrakes,
              }}
            />

            {board === "atmospheric-unmodelled" ? (
              <Section>
                <Badge tone="warn" size="sm">
                  atmospheric — descent unmodelled
                </Badge>
                <Value tone="muted" size="xs">
                  No drag model. Burn and impact numbers are suppressed rather
                  than shown wrong.
                </Value>
              </Section>
            ) : board === "no-solution" ? (
              <Section>
                <Value tone="muted">
                  No landing solution — body data unavailable.
                </Value>
              </Section>
            ) : (
              <>
                {showScope && (
                  <Section>
                    <DescentScope
                      aglMeters={heightFromTerrain ?? null}
                      verticalSpeed={solution.verticalSpeed}
                      horizontalSpeed={solution.horizontalSpeed}
                      ignitionAltitude={solution.ignitionAltitude}
                      suicideBurnCountdown={solution.suicideBurnCountdown}
                      twr={twr}
                      usingComDatum={usingComDatum}
                    />
                  </Section>
                )}

                <Section>
                  <SectionTitle>Burn</SectionTitle>
                  <Grid cols="auto 1fr" gap="xs">
                    <Field label="Burn dV">{formatDv(requiredDv)}</Field>
                    <Field label="Duration">
                      {solution.burnDuration == null
                        ? "—"
                        : formatDuration(solution.burnDuration, { ms: true })}
                    </Field>
                    <Field label="Available dV">{formatDv(availableDv)}</Field>
                    <ReadoutCaption>Affordable</ReadoutCaption>
                    {affordable == null ? (
                      <Value tone="muted">—</Value>
                    ) : (
                      <Badge tone={affordable ? "go" : "nogo"} size="sm">
                        {affordable ? "yes" : "insufficient dV"}
                      </Badge>
                    )}
                  </Grid>
                </Section>

                <Section>
                  <SectionTitle>Touchdown</SectionTitle>
                  <Grid cols="auto 1fr" gap="xs">
                    <Field label="If nothing">
                      {formatMps(solution.speedAtImpact)}
                    </Field>
                    <Field label="If burn now">
                      {solution.bestSpeedAtImpact == null
                        ? "—"
                        : formatMps(solution.bestSpeedAtImpact)}
                    </Field>
                    <Field label="Impact in">
                      {solution.timeToImpact == null
                        ? "—"
                        : formatDuration(solution.timeToImpact, { ms: true })}
                    </Field>
                  </Grid>
                  {showScope && descentHistory.length >= 2 && (
                    <Sparkline
                      values={descentHistory}
                      width={160}
                      height={28}
                      ariaLabel="Descent-rate trend"
                    />
                  )}
                </Section>
              </>
            )}

            {!scopeShown && solution.horizontalSpeed != null && (
              <Section>
                <SectionTitle>Velocity</SectionTitle>
                <Grid cols="auto 1fr" gap="xs">
                  <Field label="Vertical">
                    {formatMps(solution.verticalSpeed)}
                  </Field>
                  <Field label="Horizontal">
                    {formatMps(solution.horizontalSpeed)}
                  </Field>
                </Grid>
              </Section>
            )}

            {!scopeShown && (
              <Section>
                <SectionTitle>Height</SectionTitle>
                <Grid cols="auto 1fr" gap="xs">
                  <Field label="AGL">{formatMeters(heightFromTerrain)}</Field>
                </Grid>
                {usingComDatum && (
                  <Value tone="muted" size="xs">
                    centre-of-mass altitude (lowest-point datum unavailable)
                  </Value>
                )}
              </Section>
            )}

            {vs?.targetDistance != null && (
              <Section>
                <SectionTitle>Divert</SectionTitle>
                <Grid cols="auto 1fr" gap="xs">
                  <Field label="Target range">
                    {formatMeters(vs.targetDistance)}
                  </Field>
                </Grid>
              </Section>
            )}
          </Section>
        </ScrollArea>
      )}
    </Panel>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<LandingStatusConfig>({
  id: "landing-status",
  name: "Landing Status",
  description:
    "Composed descent instrument: altitude ladder, velocity vector, TWR gauge, delay-native commit/uncommandable clocks, affordability, and gear/brakes confirmation — built for landing under signal delay.",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 12 },
  minSize: { w: 4, h: 6 },
  component: LandingStatusComponent,
  dataRequirements: [
    // `vessel.state` (parentBodyName + targetDistance) is a DERIVED channel
    // read via useStream; the orchestrator carries it by carrying its inputs,
    // so list those SDK topics rather than the derived channel itself.
    "vessel.orbit",
    "vessel.identity",
    "system.bodies",
    "vessel.target",
    "vessel.flight",
    "vessel.surface",
    "vessel.propulsion",
    "vessel.control",
    "vessel.landing",
    "dv.summary",
    "comms.delay",
  ],
  defaultConfig: {},
  actions: landingActions,
  augmentSlots: ["landing-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
