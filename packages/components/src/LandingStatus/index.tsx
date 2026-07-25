import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type StreamStatusValue,
  useStream,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { CommsDelaySource } from "@ksp-gonogo/sitrep-sdk";
import { Gauge, Sparkline, StreamStatusBadge } from "@ksp-gonogo/ui";
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
  Stack,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AltitudeRail } from "./AltitudeRail";
import { deriveBoard } from "./board";
import { CommitLayer } from "./CommitLayer";
import { CrossSection } from "./CrossSection";
import { deriveDelayClocks } from "./clocks";
import { greatCircle } from "./geo";
import { deriveHazardVerdict } from "./hazardVerdict";
import { solveSuicideBurn } from "./solveLanding";
import { TouchdownReticle } from "./TouchdownReticle";

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

/**
 * A caption-over-value readout for the reticle's narrow side column, where a
 * side-by-side label + value would force the value to wrap. Stacked, it fills
 * the column beside the tall reticle without wrapping.
 */
function StackedField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // Column so the caption sits ABOVE the value (both are inline elements, so
  // without this they flow side-by-side and the value wraps in a narrow col).
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Value>{children}</Value>
    </div>
  );
}

/** Native per-topic stream status (same helper OrbitView/DistanceToTarget use)
 * — `"disconnected"` when no `TelemetryProvider` is mounted. Bound to
 * `vessel.surface`, the lowest-point burn datum the widget actually shows. */
function useStreamStatusOptional(topic: string): StreamStatusValue {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback(
    (): StreamStatusValue =>
      store ? store.sampleStatus(topic, store.currentFrame()) : "disconnected",
    [store, topic],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
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
  const summary = useTelemetry("dv.summary");
  const commsDelay = useTelemetry("comms.delay");
  const landing = useTelemetry("vessel.landing");

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

  const streamStatus = useStreamStatusOptional("vessel.surface");

  // The mod-side atmosphere-aware estimate (terminal-velocity model) is present
  // when the vessel.landing channel carries a terminal velocity — only in an
  // atmosphere while the relevance gate is open.
  const atmosphereAware = landing?.terminalVelocity != null;
  const board = deriveBoard({
    solutionState: solution.state,
    atmospheric,
    atmosphereAware,
  });

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
  const width = w ?? 8;
  // The flight instruments (velocity vector + TWR) and the full-height altitude
  // rail come in together at a comfortable width; below that, plain readouts.
  const showScope = width >= 6;
  const showRail = showScope;
  // The reticle is the centerpiece — shown once terrain was sampled (predicted
  // point or the sub-vessel fallback) and there's width to make it prominent.
  const showReticle = width >= 10 && landing?.sampleSource != null;
  const hazardVerdict = deriveHazardVerdict({
    slopeDeg: landing?.predictedSlopeAngle,
    roughnessSigma: landing?.predictedRoughness,
    verticalSpeed: solution.verticalSpeed,
    lateralSpeed: solution.horizontalSpeed,
    biome: landing?.predictedBiome,
  });
  // The velocity vector + TWR only carry a meaningful vacuum picture for a
  // solved descent at a wide size; elsewhere fall back to the plain, always-
  // valid velocity/height readouts.
  const scopeShown = board === "vacuum-solved" && showScope;

  // ── Section fragments (composed into the layout below) ─────────────────────

  // Ground-track bearing (sub-vessel → predicted site) — the slice direction
  // for the side-on cross-section (and the plan-view travel direction).
  const driftBearingDeg =
    flight?.latitude != null &&
    flight?.longitude != null &&
    landing?.predictedLatitude != null &&
    landing?.predictedLongitude != null &&
    body?.radius != null
      ? greatCircle(
          flight.latitude,
          flight.longitude,
          landing.predictedLatitude,
          landing.predictedLongitude,
          body.radius,
        ).bearingDeg
      : null;

  // The side-on cross-section plot (terrain profile along the ground track +
  // the velocity vector in the vertical plane), paired with the top-down reticle.
  const crossSectionEl = scopeShown ? (
    <CrossSection
      patch={landing?.terrainPatch ?? null}
      patchSize={landing?.terrainPatchSize ?? null}
      bearingDeg={driftBearingDeg}
      verticalSpeed={solution.verticalSpeed}
      horizontalSpeed={solution.horizontalSpeed}
    />
  ) : null;

  const twrGaugeEl = (
    <Gauge
      value={twr ?? 0}
      min={0}
      max={3}
      width={132}
      height={84}
      zones={[
        { from: 0, to: 1, color: "var(--color-status-nogo-fg)" },
        { from: 1, to: 1.5, color: "var(--color-status-warning-fg)" },
        { from: 1.5, to: 3, color: "var(--color-status-go-fg)" },
      ]}
      valueLabel={twr == null ? "—" : twr.toFixed(2)}
      unitLabel="TWR"
      ariaLabel={`TWR ${twr == null ? "unknown" : twr.toFixed(2)}`}
    />
  );

  const comDatumNote = usingComDatum ? (
    <Value tone="muted" size="xs">
      centre-of-mass altitude (lowest-point datum unavailable)
    </Value>
  ) : null;

  // Compact caption-over-value burn/touchdown readouts, used both in the
  // reticle's right-column third and in the small-size detail stack.
  const readoutsStack =
    board === "vacuum-solved" ? (
      <Stack gap="xs">
        <StackedField label="Burn dV">{formatDv(requiredDv)}</StackedField>
        <StackedField label="Burn duration">
          {solution.burnDuration == null
            ? "—"
            : formatDuration(solution.burnDuration, { ms: true })}
        </StackedField>
        <StackedField label="Available dV">
          {formatDv(availableDv)}
        </StackedField>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "start",
          }}
        >
          <ReadoutCaption>Affordable</ReadoutCaption>
          {affordable == null ? (
            <Value tone="muted">—</Value>
          ) : (
            <Badge tone={affordable ? "go" : "nogo"} size="sm">
              {affordable ? "yes" : "insufficient dV"}
            </Badge>
          )}
        </div>
        <StackedField label="Touchdown (coast)">
          {formatMps(solution.speedAtImpact)}
        </StackedField>
        <StackedField label="Touchdown (burn now)">
          {solution.bestSpeedAtImpact == null
            ? "—"
            : formatMps(solution.bestSpeedAtImpact)}
        </StackedField>
        <StackedField label="Impact in">
          {solution.timeToImpact == null
            ? "—"
            : formatDuration(solution.timeToImpact, { ms: true })}
        </StackedField>
        {vs?.targetDistance != null && (
          <StackedField label="Target range">
            {formatMeters(vs.targetDistance)}
          </StackedField>
        )}
        {scopeShown && descentHistory.length >= 2 && (
          <Sparkline
            values={descentHistory}
            width={120}
            height={24}
            ariaLabel="Descent-rate trend"
          />
        )}
      </Stack>
    ) : null;

  const boardEl =
    board === "atmospheric-aware" ? (
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <Field label="Terminal">{formatMps(landing?.terminalVelocity)}</Field>
          <Field label="Touchdown">
            {formatMps(landing?.projectedTouchdownSpeed)}
          </Field>
          <Field label="Impact in">
            {landing?.atmosphericTimeToImpact == null
              ? "—"
              : formatDuration(landing.atmosphericTimeToImpact, { ms: true })}
          </Field>
          {landing?.descentRegime && (
            <Field label="Regime">{landing.descentRegime}</Field>
          )}
        </Grid>
        <Value tone="muted" size="xs">
          est · current config
          {landing?.parachuteState === "armed" ? " · excludes chute" : ""}
        </Value>
      </Section>
    ) : board === "atmospheric-unmodelled" ? (
      <Section>
        <Badge tone="warn" size="sm">
          descent unmodelled
        </Badge>
      </Section>
    ) : board === "no-solution" ? (
      <Section>
        <Value tone="muted">no solution · no body data</Value>
      </Section>
    ) : null;

  const velocityEl =
    !scopeShown && solution.horizontalSpeed != null ? (
      <Section>
        <SectionTitle>Velocity</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <Field label="Vertical">{formatMps(solution.verticalSpeed)}</Field>
          <Field label="Horizontal">
            {formatMps(solution.horizontalSpeed)}
          </Field>
        </Grid>
      </Section>
    ) : null;

  // Plain AGL readout only when there's no altitude rail (small size). The rail
  // is the altitude carrier everywhere else.
  const heightEl = !showRail ? (
    <Section>
      <SectionTitle>Height</SectionTitle>
      <Grid cols="auto 1fr" gap="xs">
        <Field label="AGL">{formatMeters(heightFromTerrain)}</Field>
      </Grid>
      {/* The CoM-datum caveat is carried once by `comDatumNote` (in the detail
          stack / right column), so it isn't repeated here. */}
    </Section>
  ) : null;

  const divertEl =
    vs?.targetDistance != null ? (
      <Section>
        <SectionTitle>Divert</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <Field label="Target range">{formatMeters(vs.targetDistance)}</Field>
        </Grid>
      </Section>
    ) : null;

  const commitLayerEl = (
    <CommitLayer
      regime={clocks.regime}
      roundTripSeconds={clocks.roundTripSeconds}
      live={live}
      suicideBurnCountdown={solution.suicideBurnCountdown}
      commitInSeconds={clocks.commitInSeconds}
      committed={clocks.committed}
      blindInSeconds={clocks.blindInSeconds}
      blind={clocks.blind}
    />
  );

  // Everything that isn't the reticle: the cross-section, TWR, numbers + notes,
  // in the order they matter. Non-relevant fragments are null and drop out. Used
  // at sizes without the reticle (below the wide-size two-plots layout).
  const detailStack = (
    <Stack gap="sm">
      {crossSectionEl}
      {scopeShown && twrGaugeEl}
      {boardEl}
      {velocityEl}
      {readoutsStack}
      {comDatumNote}
      {heightEl}
      {divertEl}
    </Stack>
  );

  const reticleEl = showReticle ? (
    <Section>
      <SectionTitle>Touchdown site</SectionTitle>
      <TouchdownReticle
        siteLat={landing?.predictedLatitude ?? null}
        siteLon={landing?.predictedLongitude ?? null}
        vesselLat={flight?.latitude ?? null}
        vesselLon={flight?.longitude ?? null}
        bodyRadius={body?.radius ?? null}
        slopeDeg={landing?.predictedSlopeAngle ?? null}
        biome={landing?.predictedBiome ?? null}
        sampleSource={landing?.sampleSource ?? null}
        verdict={hazardVerdict}
        terrainPatch={landing?.terrainPatch ?? null}
        terrainPatchSize={landing?.terrainPatchSize ?? null}
      />
    </Section>
  ) : null;

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
        // The body is a row: the altitude rail runs the full height down the
        // left edge, the scrolling main content fills the rest.
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            gap: "0.75rem",
            alignItems: "stretch",
          }}
        >
          {showRail && (
            <div style={{ flex: "0 0 auto", width: 72 }}>
              <AltitudeRail
                aglMeters={heightFromTerrain ?? null}
                ignitionAltitude={solution.ignitionAltitude}
                suicideBurnCountdown={solution.suicideBurnCountdown}
              />
            </div>
          )}
          <ScrollArea>
            {/* `lg` gap gives the major blocks (delay, commit hero, site) real
                vertical separation — Section's own `xs` (2px) is the tight
                within-group gap and read as cramped between headings. */}
            <Stack gap="lg">
              {commitLayerEl}
              {showReticle ? (
                // Two square altimetry plots side by side (top-down reticle |
                // side-on cross-section) in the left two-thirds, with the TWR
                // gauge + readouts filling the right column third.
                // `align-items:start` keeps cells pinned to the top.
                <Grid cols="2fr 1fr" gap="md" style={{ alignItems: "start" }}>
                  <Grid cols="1fr 1fr" gap="sm" style={{ alignItems: "start" }}>
                    {reticleEl}
                    {crossSectionEl && (
                      <Section>
                        <SectionTitle>Cross-section</SectionTitle>
                        {crossSectionEl}
                      </Section>
                    )}
                  </Grid>
                  <Stack gap="sm">
                    {twrGaugeEl}
                    {boardEl}
                    {readoutsStack}
                    {comDatumNote}
                    {divertEl}
                  </Stack>
                </Grid>
              ) : (
                detailStack
              )}
            </Stack>
          </ScrollArea>
        </div>
      )}
    </Panel>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<LandingStatusConfig>({
  id: "landing-status",
  name: "Landing Status",
  description:
    "Composed descent instrument for landing under signal delay: a full-height altitude rail, two altimetry plots (top-down touchdown reticle + side-on terrain cross-section with the velocity vector), TWR, and delay-native commit/uncommandable clocks with the suicide-burn cue. An instrument, not a command surface (fly gear/brakes from action-group widgets).",
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
    "vessel.landing",
    "dv.summary",
    "comms.delay",
  ],
  defaultConfig: {},
  augmentSlots: ["landing-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
