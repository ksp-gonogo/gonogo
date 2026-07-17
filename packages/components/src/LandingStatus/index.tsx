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
import { StreamStatusBadge } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  EmptyState,
  formatDuration,
  Grid,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  ScrollArea,
  Section,
  SectionTitle,
  StatusPill,
  Value,
} from "@ksp-gonogo/ui-kit";
import { deriveDelayClocks, type LandingRegime } from "./clocks";
import { solveSuicideBurn } from "./solveLanding";

// Empty config — kept for forward-compat with the old widget's config slot.
type LandingStatusConfig = Record<string, never>;

/**
 * Props for `landing-status.badges` — the widget's BROAD escape-hatch slot,
 * rendered in the header row next to the title. A cheap integration seam for
 * small inline status chips an Uplink wants beside the "LANDING" title (e.g. a
 * landing-guidance quality chip). Badge augments read their own Topics via
 * hooks, so only labelling context is passed down. Preserved verbatim from the
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

const REGIME_LABEL: Record<LandingRegime, string> = {
  live: "LIVE",
  staged: "STAGED",
  autonomous: "AUTONOMOUS",
  "no-path": "LINK —",
};

const REGIME_TONE: Record<LandingRegime, ReadoutTone> = {
  live: "go",
  staged: "warning",
  autonomous: "alert",
  "no-path": "default",
};

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

// ── Configuration row (gear/brakes with pending/confirmed lifecycle) ──────────

function ConfigRow({
  label,
  on,
  phase,
  onToggle,
}: {
  label: string;
  on: boolean | undefined;
  phase: string;
  onToggle: () => void;
}) {
  const pending = phase === "in-flight";
  const failed = phase === "failed" || phase === "lost";
  const tone: "neutral" | "go" | "nogo" | "warn" = failed
    ? "nogo"
    : pending
      ? "warn"
      : on
        ? "go"
        : "neutral";
  const stateText = pending
    ? "sending…"
    : failed
      ? "no reply"
      : on === undefined
        ? "—"
        : on
          ? "on"
          : "off";
  return (
    <Cluster justify="between" gap="sm">
      <button type="button" onClick={onToggle} aria-label={`Toggle ${label}`}>
        {label}
      </button>
      <Badge tone={tone} size="sm">
        {stateText}
      </Badge>
    </Cluster>
  );
}

function LandingStatusComponent({
  h,
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

  // Burn datum: the vessel's LOWEST point above terrain, not its centre of
  // mass. `vessel.surface.heightFromTerrain` is the number a suicide-burn
  // widget actually cares about — how far the gear is from the ground. The
  // capture side nulls the whole `vessel.surface` channel while Orbiting/
  // Escaping, so fall back to the CoM radar altitude (`vessel.flight.
  // altitudeTerrain`) with a visible note when it's absent.
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

  // Affordability — required burn dV vs. remaining dV in the stack. Total
  // remaining actual dV is the honest "can I afford this at all" denominator.
  const availableDv = summary?.totalDvActual ?? summary?.totalDvVac;
  const requiredDv = solution.burnDeltaV;
  const affordable =
    requiredDv != null && availableDv != null
      ? requiredDv <= availableDv
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

  // Board state drives WHICH readouts exist — we never show a confident number
  // from a model that doesn't apply. Atmospheric bodies suppress the vacuum
  // burn/impact numbers entirely rather than hedge a wrong one.
  const board:
    | "not-descending"
    | "no-solution"
    | "atmospheric-unmodelled"
    | "vacuum-solved" =
    solution.state === "not-descending"
      ? "not-descending"
      : atmospheric
        ? "atmospheric-unmodelled"
        : solution.state === "no-solution"
          ? "no-solution"
          : "vacuum-solved";

  const rows = h ?? 10;
  const showSubtitle = rows >= 6;

  const badgesContext: LandingStatusBadgesContext = {
    bodyName: bodyName ?? null,
    atmospheric,
  };

  const live = clocks.regime === "live" || clocks.regime === "no-path";

  // Headline hero. Live/no-delay: the ignition countdown. Delayed: the Commit
  // Clock — the last instant a GO can still reach the vessel — which is the
  // number that actually matters once the loop can't be closed.
  const countdown = solution.suicideBurnCountdown;
  let heroValue: string;
  let heroCaption: string;
  let heroTone: ReadoutTone;
  let urgent = false;
  if (live) {
    heroCaption = "SUICIDE BURN";
    if (countdown == null) {
      heroValue = "—";
      heroTone = "default";
    } else if (countdown <= 0) {
      heroValue = "IGNITE";
      heroTone = "alert";
      urgent = true;
    } else {
      heroValue = `T−${formatDuration(countdown, { ms: true })}`;
      urgent = countdown <= 5;
      heroTone = urgent ? "alert" : "warning";
    }
  } else {
    heroCaption = "COMMIT IN";
    if (clocks.committed) {
      heroValue = "COMMITTED";
      heroTone = "alert";
    } else if (clocks.commitInSeconds == null) {
      heroValue = "—";
      heroTone = "default";
    } else {
      heroValue = `T−${formatDuration(clocks.commitInSeconds, { ms: true })}`;
      heroTone = "warning";
    }
  }

  return (
    <Panel>
      <Cluster>
        <PanelTitle>LANDING</PanelTitle>
        <AugmentSlot name="landing-status.badges" props={badgesContext} />
        <StreamStatusBadge status={streamStatus} />
      </Cluster>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>
          {bodyName}
          {atmospheric ? " · atmospheric" : " · vacuum"}
        </PanelSubtitle>
      )}

      {board === "not-descending" ? (
        <EmptyState>No landing in progress</EmptyState>
      ) : (
        <Body>
          <Section>
            <SectionTitle>Delay</SectionTitle>
            <Cluster justify="start" gap="sm">
              <StatusPill $tone={REGIME_TONE[clocks.regime]}>
                {REGIME_LABEL[clocks.regime]}
              </StatusPill>
              {clocks.roundTripSeconds != null &&
                clocks.roundTripSeconds > 0 && (
                  <Value tone="muted">
                    RT {formatDuration(clocks.roundTripSeconds, { ms: true })}
                  </Value>
                )}
            </Cluster>
          </Section>

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
              <Section
                role={urgent ? "alert" : "status"}
                aria-live={urgent ? "assertive" : "polite"}
              >
                <Readout $tone={heroTone}>
                  {heroValue}
                  <ReadoutCaption>{heroCaption}</ReadoutCaption>
                </Readout>
                {!live && clocks.blindInSeconds != null && (
                  <Value tone={clocks.blind ? "accent" : "muted"} size="sm">
                    {clocks.blind
                      ? "BLIND — outcome determined"
                      : `Blind in ${formatDuration(clocks.blindInSeconds, { ms: true })}`}
                  </Value>
                )}
              </Section>

              <Section>
                <SectionTitle>Burn</SectionTitle>
                <Grid cols="auto 1fr" gap="xs">
                  <Field label="Ignition">
                    {countdown == null
                      ? "—"
                      : countdown <= 0
                        ? "now"
                        : `T−${formatDuration(countdown, { ms: true })}`}
                  </Field>
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
              </Section>
            </>
          )}

          {/* Velocity split — vertical AND horizontal, always, on vacuum and
              atmospheric bodies alike. Horizontal is the component the old
              vertical-only model ignored, and the one that tips a lander over. */}
          {solution.horizontalSpeed != null && (
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

          <Section>
            <SectionTitle>Height</SectionTitle>
            <Grid cols="auto 1fr" gap="xs">
              <Field label="AGL">{formatMeters(heightFromTerrain)}</Field>
              {solution.verticalSpeed != null && (
                <Field label="Descent">
                  {formatMps(solution.verticalSpeed)}
                </Field>
              )}
            </Grid>
            {usingComDatum && (
              <Value tone="muted" size="xs">
                centre-of-mass altitude (lowest-point datum unavailable)
              </Value>
            )}
          </Section>

          <Section>
            <SectionTitle>Configuration</SectionTitle>
            <ConfigRow
              label="Gear"
              on={gearOn}
              phase={gearCmd.status.phase}
              onToggle={toggleGear}
            />
            <ConfigRow
              label="Brakes"
              on={brakesOn}
              phase={brakesCmd.status.phase}
              onToggle={toggleBrakes}
            />
          </Section>

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
        </Body>
      )}
    </Panel>
  );
}

// ── Body layout ───────────────────────────────────────────────────────────────

/**
 * Scrollable column so no section is ever unreachable at small sizes — the
 * headline hero + delay banner sit at the top, so a compact widget always shows
 * the two things that matter (regime + commit/ignition clock) and the operator
 * can scroll to the rest. Composed from ui-kit's ScrollArea; no bespoke CSS.
 */
function Body({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea>
      <Section>{children}</Section>
    </ScrollArea>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<LandingStatusConfig>({
  id: "landing-status",
  name: "Landing Status",
  description:
    "Full-vector suicide-burn solve, delay-native commit/blind clocks, velocity split, affordability, and gear/brakes confirmation — built for landing under signal delay.",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 5 },
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
