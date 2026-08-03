import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { CommsDelaySource } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  EmptyState,
  FramedDisplay,
  formatDuration,
  Grid,
  NULL_DISPLAY,
  Panel,
  Quantity,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  SectionTitle,
  Stack,
  StatusPill,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { AltitudeRail } from "./AltitudeRail";
import { deriveBoard } from "./board";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { CrossSection } from "./CrossSection";
import { deriveDelayClocks } from "./clocks";
import { DescentEnvelope } from "./DescentEnvelope";
import { greatCircle } from "./geo";
import { deriveHazardVerdict } from "./hazardVerdict";
import { solveSuicideBurn } from "./solveLanding";
import { TouchdownReticle } from "./TouchdownReticle";

// Empty config: kept for forward-compat with the old widget's config slot.
type LandingStatusConfig = Record<string, never>;

/**
 * Props for `landing-status.badges`: the widget's BROAD escape-hatch slot,
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
  if (v === null || v === undefined || !Number.isFinite(v)) return NULL_DISPLAY;
  if (Math.abs(v) < 10) return `${v.toFixed(2)} m/s`;
  if (Math.abs(v) < 100) return `${v.toFixed(1)} m/s`;
  return `${v.toFixed(0)} m/s`;
}

// The shared `length` ladder with this widget's own precision. A descent
// readout wants two decimals between 1 and 10 km (10 m of altitude, which is
// the difference between a landing and a crater) and whole metres in the last
// kilometre. The rungs are shared; only the precision is local.
// The shared `length` ladder with this widget's own precision. A descent
// readout wants two decimals between 1 and 10 km (10 m of altitude, which is
// the difference between a landing and a crater) and whole metres in the last
// kilometre. The rungs are shared; only the precision is local.
function Metres({ m }: { m: number | null | undefined }) {
  if (m === null || m === undefined || !Number.isFinite(m)) return NULL_DISPLAY;
  const abs = Math.abs(m);
  return (
    <Quantity
      value={m}
      unit="m"
      decimals={abs >= 10_000 ? 1 : abs >= 1000 ? 2 : 0}
    />
  );
}

function formatDv(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NULL_DISPLAY;
  return `${v.toFixed(0)} m/s`;
}

interface StageLike {
  stage?: number;
  dvActual?: number;
  dvVac?: number;
  startMass?: number;
  endMass?: number;
}

/**
 * Active-engine burn parameters for the rocket-equation suicide-burn solve: the
 * effective exhaust velocity `ve` (= Isp·g0) and the burnout mass.
 *
 * PREFER the ACTIVE stage (`dv.stages` matched by `vessel.structure.currentStage`)
 * because those are the engine(s) actually flying the landing burn: its ΔV +
 * mass ratio fix that engine's ve (atmosphere-adjusted, from the "actual" ΔV),
 * and its end mass is the burn's floor. `dv.summary.totalDvActual` is the
 * WHOLE-VESSEL multi-stage total, so it must NOT be used directly here: on a
 * multi-stage craft it's an average across engines with different Isp.
 *
 * Fall back to the whole-vessel `dv.summary` + `propulsion.dryMass` only when the
 * per-stage data is absent: exact for a single-stage lander (the common landing
 * case: total == active stage), a coarse average otherwise, still better than a
 * constant-decel guess. Returns `{}` when nothing usable is on the wire.
 */
export function deriveActiveBurnParams(
  stages: readonly StageLike[] | undefined,
  currentStage: number | undefined,
  propulsion: { totalMass?: number; dryMass?: number } | undefined,
  summary: { totalDvActual?: number; totalDvVac?: number } | undefined,
): { exhaustVelocity?: number; burnoutMass?: number } {
  const active = stages?.find((s) => s.stage === currentStage);
  if (active) {
    const dv = active.dvActual ?? active.dvVac;
    const { startMass, endMass } = active;
    if (
      dv != null &&
      dv > 0 &&
      startMass != null &&
      endMass != null &&
      startMass > endMass &&
      endMass > 0
    ) {
      return {
        exhaustVelocity: dv / Math.log(startMass / endMass),
        burnoutMass: endMass,
      };
    }
  }
  const dv = summary?.totalDvActual ?? summary?.totalDvVac;
  const totalMass = propulsion?.totalMass;
  const dryMass = propulsion?.dryMass;
  if (
    dv != null &&
    dv > 0 &&
    totalMass != null &&
    dryMass != null &&
    totalMass > dryMass &&
    dryMass > 0
  ) {
    return {
      exhaustVelocity: dv / Math.log(totalMass / dryMass),
      burnoutMass: dryMass,
    };
  }
  return {};
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
function GridCellPair({
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

/**
 * The visible height of the enclosing `Panel.Body`, in pixels, and the callback
 * ref that finds it.
 *
 * The rail wants to be the full height of the widget as DISPLAYED, which is the
 * scroller's own box, not the height of the content inside it. No percentage
 * expresses that from within: a child's `height: 100%` resolves against the
 * flex row it sits in, which is as tall as the content and therefore too tall
 * the moment anything overflows.
 *
 * A CALLBACK ref, not `useRef` + `useEffect`. The row this measures from only
 * exists once a descent is streaming, and an effect keyed on a ref object runs
 * exactly once, on the first render, when that row is not mounted yet: it found
 * nothing, returned, and never ran again, so the height stayed 0 and the rail
 * silently fell back to its content height. A callback ref runs on every attach
 * and detach, which is the actual lifecycle here.
 */
function useScrollerHeight(): [(node: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const box = node?.closest("[data-panel-body]");
    if (!(box instanceof HTMLElement)) return;
    // clientHeight is the PADDING box. The rail lives inside the content box,
    // so using clientHeight made it overrun the visible bottom by exactly the
    // body's vertical inset, which is what clipped its footer label.
    const contentHeight = () => {
      const cs = getComputedStyle(box);
      return (
        box.clientHeight -
        Number.parseFloat(cs.paddingTop || "0") -
        Number.parseFloat(cs.paddingBottom || "0")
      );
    };
    setHeight(contentHeight());
    const ro = new ResizeObserver(() => setHeight(contentHeight()));
    ro.observe(box);
    observer.current = ro;
  }, []);
  return [measure, height];
}

const DESCENT_HISTORY_MAX = 60;

// Atmospheric terrain-plot gating. The plots (top-down site + cross-section) are
// a pinpoint-landing view, meaningful only once the predicted touchdown point
// has SETTLED (a jumpy high-altitude prediction is drag noise, not a site). Show
// them on an atmospheric board when the predicted point is moving slowly OR the
// vessel is already low (final approach under chutes), never at hypersonic entry.
const PREDICTION_STABLE_M = 250; // predicted point moves < this per tick ⇒ settled
const ATMO_PLOTS_ALT_GATE = 10_000; // …or below this AGL, show them regardless

// Landing-ZONE heuristic (no dispersion on the wire, so derived): the touchdown
// point could drift by ~this fraction of the remaining horizontal travel; floored
// at the terrain-sample footprint so it never reads tighter than we actually know.
const LANDING_ZONE_DISPERSION = 0.12;
const LANDING_ZONE_FLOOR_M = 30;
// The reticle / cross-section SLIDING scale: the spatial full-scale zooms to
// contain the drift + the zone (so a close approach fills the plot instead of
// sitting as a dot at a fixed 3 km scale), clamped to a sane window.
const RETICLE_SPAN_MIN_M = 300;
const RETICLE_SPAN_MAX_M = 6000;

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const [measureScroller, scrollerHeight] = useScrollerHeight();

  const vs = useStream<VesselState>("vessel.state");
  const bodyName = vs?.parentBodyName ?? undefined;
  const body = bodyName ? getBody(bodyName) : undefined;
  const atmospheric = body?.hasAtmosphere ?? false;

  const flight = useTelemetry("vessel.flight");
  const surface = useTelemetry("vessel.surface");
  const propulsion = useTelemetry("vessel.propulsion");
  const orbit = useTelemetry("vessel.orbit");
  const summary = useTelemetry("dv.summary");
  const dvStages = useTelemetry("dv.stages");
  const structure = useTelemetry("vessel.structure");
  const commsDelay = useTelemetry("comms.delay");
  const landing = useTelemetry("vessel.landing");

  // ve + burnout mass of the ACTIVE engine(s), see `deriveActiveBurnParams`.
  const { exhaustVelocity, burnoutMass } = deriveActiveBurnParams(
    dvStages,
    structure?.currentStage,
    propulsion,
    summary,
  );

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
    exhaustVelocity,
    burnoutMass,
  });

  // Touched down: a landed (or splashed) vessel can still report a residual
  // altitude + a stale time-to-impact, so gate the descent clocks on the landed
  // STATE rather than on the impact figure. `vessel.surface.landedAt` (the UT of
  // touchdown) is the direct, reliable signal; the situation-name / splashed
  // flags back it up where a source populates those instead.
  const landed =
    surface?.landedAt != null ||
    vs?.situationName === "Landed" ||
    vs?.isSplashed === true;

  const oneWaySeconds = readOneWaySeconds(commsDelay);
  const clocks = deriveDelayClocks({
    oneWaySeconds,
    suicideBurnCountdown: solution.suicideBurnCountdown,
    timeToImpact: solution.timeToImpact,
    landed,
  });

  // No viable landing vector: a real vacuum solution exists but the full-vector
  // burn can't be nulled within the remaining altitude, so even an optimal burn
  // still hits the ground at `bestSpeedAtImpact`: there is no descent trajectory
  // to a safe touchdown. Distinct from a NOMINAL committed burn (bestSpeedAtImpact
  // 0 = the burn fits and a safe landing IS coming); do NOT conflate the two.
  const noLandingVector =
    !landed &&
    solution.state === "vacuum-solved" &&
    solution.bestSpeedAtImpact != null &&
    solution.bestSpeedAtImpact > 0.5;

  const availableDv = summary?.totalDvActual ?? summary?.totalDvVac;
  const requiredDv = solution.burnDeltaV;
  const affordable =
    requiredDv != null && availableDv != null
      ? requiredDv <= availableDv
      : null;

  // The mod-side atmosphere-aware estimate (terminal-velocity model) is present
  // when the vessel.landing channel carries a terminal velocity, only in an
  // atmosphere while the relevance gate is open.
  const atmosphereAware = landing?.terminalVelocity != null;
  const board = deriveBoard({
    solutionState: solution.state,
    atmospheric,
    atmosphereAware,
  });

  // Descent-rate trend: a bounded history of vertical speed, so a developing
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

  // Prediction stability: how far the predicted touchdown point moved since the
  // last tick (great-circle metres). A settled prediction is the real signal that
  // a pinpoint site is worth drawing on an atmospheric descent.
  const prevPredictedRef = useRef<{ lat: number; lon: number } | null>(null);
  const [predictionMovement, setPredictionMovement] = useState<number | null>(
    null,
  );
  const predLat = landing?.predictedLatitude;
  const predLon = landing?.predictedLongitude;
  const bodyRadius = body?.radius;
  useEffect(() => {
    if (predLat == null || predLon == null || bodyRadius == null) {
      prevPredictedRef.current = null;
      setPredictionMovement(null);
      return;
    }
    const prev = prevPredictedRef.current;
    if (prev) {
      setPredictionMovement(
        greatCircle(prev.lat, prev.lon, predLat, predLon, bodyRadius)
          .distanceMeters,
      );
    }
    prevPredictedRef.current = { lat: predLat, lon: predLon };
  }, [predLat, predLon, bodyRadius]);

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
  // The reticle is the centerpiece, shown once terrain was sampled (predicted
  // point or the sub-vessel fallback) and there's width to make it prominent.
  // The two-plot row FLEX-WRAPS (see below), so from ~8 wide it degrades by
  // STACKING the plots rather than dropping the top-down one; only below the
  // scope width do we fall back to plain readouts.
  // On an ATMOSPHERIC board the terrain plots re-appear only once the predicted
  // point has settled (or the vessel is already low), see the gate constants.
  // On a vacuum board a sample alone is enough (the burn solve is the site).
  const predictionStable =
    predictionMovement != null && predictionMovement < PREDICTION_STABLE_M;
  const lowApproach =
    heightFromTerrain != null && heightFromTerrain < ATMO_PLOTS_ALT_GATE;
  const atmosphericPlotsShown =
    atmospheric &&
    landing?.sampleSource != null &&
    (predictionStable || lowApproach);
  const showReticle =
    width >= 8 &&
    landing?.sampleSource != null &&
    (!atmospheric || atmosphericPlotsShown);
  const hazardVerdict = deriveHazardVerdict({
    slopeDeg: landing?.predictedSlopeAngle,
    roughnessSigma: landing?.predictedRoughness,
    verticalSpeed: solution.verticalSpeed,
    lateralSpeed: solution.horizontalSpeed,
    biome: landing?.predictedBiome,
  });
  // The velocity vector + TWR only carry a meaningful vacuum picture for a
  // solved descent at a wide size; elsewhere fall back to the plain, always-
  // valid velocity/height readouts. Once landed we KEEP the spatial scope (the
  // plots showing the vessel now AT the site) even though the burn solution has
  // gone idle: a "touchdown confirmed" view, not a blank panel.
  const scopeShown =
    (board === "vacuum-solved" || landed || atmosphericPlotsShown) && showScope;

  // ── Section fragments (composed into the layout below) ─────────────────────

  // Displacement sub-vessel → predicted site: bearing is the ground-track slice
  // direction for the cross-section; distance is the downrange readout.
  const siteDrift =
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
        )
      : null;
  const driftBearingDeg = siteDrift?.bearingDeg ?? null;

  // Landing ZONE (a circle of possible touchdown, not a pinpoint). No dispersion
  // on the wire, so derived: a fraction of the remaining horizontal travel
  // (shrinks as the descent closes), floored at the terrain-sample footprint so
  // it never reads tighter than the terrain we actually sampled. Only when a
  // site was sampled at all.
  const timeToImpactForZone = atmospheric
    ? (landing?.atmosphericTimeToImpact ?? null)
    : solution.timeToImpact;
  const landingZoneRadiusM =
    landing?.sampleSource != null
      ? Math.max(
          landing?.roughnessFootprintMeters ?? 0,
          LANDING_ZONE_FLOOR_M,
          solution.horizontalSpeed != null && timeToImpactForZone != null
            ? LANDING_ZONE_DISPERSION *
                solution.horizontalSpeed *
                timeToImpactForZone
            : 0,
        )
      : null;

  // Sliding spatial scale: zoom the reticle / cross-section to contain the drift
  // and the zone, so a close approach fills the plot (was a fixed 3 km scale).
  const reticleSpanMeters = Math.min(
    RETICLE_SPAN_MAX_M,
    Math.max(
      RETICLE_SPAN_MIN_M,
      (siteDrift?.distanceMeters ?? 0) * 1.4,
      (landingZoneRadiusM ?? 0) * 2.4,
    ),
  );

  // The side-on cross-section plot (terrain profile along the ground track +
  // the velocity vector in the vertical plane), paired with the top-down reticle.
  const crossSectionEl = scopeShown ? (
    <CrossSection
      patch={landing?.terrainPatch ?? null}
      patchSize={landing?.terrainPatchSize ?? null}
      bearingDeg={driftBearingDeg}
      verticalSpeed={solution.verticalSpeed}
      horizontalSpeed={solution.horizontalSpeed}
      aglMeters={heightFromTerrain ?? null}
      driftMeters={siteDrift?.distanceMeters ?? null}
      spanMeters={reticleSpanMeters}
    />
  ) : null;

  // TWR is its own widget. It was here because a descent wants it, but a
  // dashboard that wants it can place the TWR widget beside this one, and
  // carrying a second copy cost this panel a whole band of vertical space it
  // needs for the plots.

  // The velocity-altitude envelope: a square plot, shown whenever the mod's
  // terminal-velocity model is present (atmospheric-aware board). Composed as a
  // plot alongside the reticle + cross-section (see the plots row / detail stack).
  const envelopeEl =
    board === "atmospheric-aware" ? (
      <DescentEnvelope
        currentSpeed={flight?.surfaceSpeed ?? null}
        currentAltitude={heightFromTerrain ?? null}
        terminalVelocity={landing?.terminalVelocity ?? null}
        projectedTouchdownSpeed={landing?.projectedTouchdownSpeed ?? null}
        atmosphereColor={body?.atmosphereColor ?? null}
        dragToWeight={landing?.dragToWeightRatio ?? null}
        dragDisplay="arrow"
      />
    ) : null;

  const comDatumNote = usingComDatum ? (
    <Value tone="muted" size="xs">
      centre-of-mass altitude (lowest-point datum unavailable)
    </Value>
  ) : null;

  // Compact caption-over-value burn/touchdown readouts. `minColWidth` makes it
  // auto-column: one column in the narrow detail stack, a multi-column row when
  // it sits full-width underneath the plots.
  const readoutsStack = landed ? (
    // Touchdown-confirmed readouts: the outcome-relevant numbers (how soft, how
    // much fuel is left), not the now-void in-flight burn countdowns. The site
    // verdict + biome/slope ride the banner + terrain readout above.
    <Grid minColWidth="130px" gap="sm">
      <StackedField label="Touchdown speed">
        {formatMps(flight?.surfaceSpeed ?? solution.horizontalSpeed)}
      </StackedField>
      <StackedField label="Fuel remaining">
        {formatDv(availableDv)}
      </StackedField>
    </Grid>
  ) : board === "vacuum-solved" ? (
    // Under NO LANDING VECTOR every number here (burn dV you can afford, dV in
    // the tank, coast speed) is moot context, not a positive: dim the whole
    // grid so it can't read as reassurance against the ABORT hero above.
    <div style={noLandingVector ? { opacity: 0.5 } : undefined}>
      <Grid minColWidth="130px" gap="sm">
        <StackedField label="Burn dV">{formatDv(requiredDv)}</StackedField>
        <StackedField label="Burn duration">
          {solution.burnDuration == null
            ? NULL_DISPLAY
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
          {noLandingVector ? (
            // Fuel isn't the wall (there's no path at all): a green "yes" here
            // would contradict the ABORT above, so mute it.
            <Value tone="muted">n/a · no path</Value>
          ) : affordable == null ? (
            <Value tone="muted">{NULL_DISPLAY}</Value>
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
            ? NULL_DISPLAY
            : formatMps(solution.bestSpeedAtImpact)}
        </StackedField>
        <StackedField label="Impact in">
          {landed || solution.timeToImpact == null
            ? NULL_DISPLAY
            : formatDuration(solution.timeToImpact, { ms: true })}
        </StackedField>
        {vs?.targetDistance != null && (
          <StackedField label="Target range">
            {<Metres m={vs.targetDistance} />}
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
      </Grid>
    </div>
  ) : null;

  const boardEl =
    board === "atmospheric-aware" ? (
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <GridCellPair label="Terminal">
            {formatMps(landing?.terminalVelocity)}
          </GridCellPair>
          <GridCellPair label="Touchdown">
            {formatMps(landing?.projectedTouchdownSpeed)}
          </GridCellPair>
          <GridCellPair label="Impact in">
            {landing?.atmosphericTimeToImpact == null
              ? NULL_DISPLAY
              : formatDuration(landing.atmosphericTimeToImpact, { ms: true })}
          </GridCellPair>
          {landing?.descentRegime && (
            <GridCellPair label="Regime">{landing.descentRegime}</GridCellPair>
          )}
        </Grid>
        <Value tone="muted" size="xs">
          est · current config
          {landing?.parachuteState === "armed" ? " · excludes chute" : ""}
        </Value>
      </Section>
    ) : board === "atmospheric-estimate" ? (
      // Descending in atmosphere but the mod shipped no terminal velocity yet
      // (drag not measurable this tick / stale source). Not "unmodelled": show
      // the honest state: the velocity + air density, and that the vessel is
      // still above terminal with drag building. An estimate, labelled as one.
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <GridCellPair label="Vertical">
            {formatMps(solution.verticalSpeed)}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {formatMps(solution.horizontalSpeed)}
          </GridCellPair>
          <GridCellPair label="Air density">
            {flight?.atmDensity == null || !Number.isFinite(flight.atmDensity)
              ? NULL_DISPLAY
              : flight.atmDensity < 0.001
                ? "negligible"
                : `${flight.atmDensity.toFixed(3)} kg/m³`}
          </GridCellPair>
        </Grid>
        <Value tone="muted" size="xs">
          {flight?.atmDensity != null && flight.atmDensity < 0.001
            ? "negligible drag · near free-fall, terminal velocity resolves as air thickens"
            : "above terminal · drag building, terminal velocity resolves as descent continues"}
        </Value>
      </Section>
    ) : board === "atmospheric-unmodelled" ? (
      <Section>
        <Value tone="muted" size="xs">
          descent in atmosphere · no terrain model (no body data)
        </Value>
      </Section>
    ) : board === "no-solution" ? (
      <Section>
        <Value tone="muted">no solution · no body data</Value>
      </Section>
    ) : null;

  const velocityEl =
    // The atmospheric-estimate board carries its own velocity split, so don't
    // repeat it in the standalone Velocity section.
    !scopeShown &&
    board !== "atmospheric-estimate" &&
    solution.horizontalSpeed != null ? (
      <Section>
        <SectionTitle>Velocity</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <GridCellPair label="Vertical">
            {formatMps(solution.verticalSpeed)}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {formatMps(solution.horizontalSpeed)}
          </GridCellPair>
        </Grid>
      </Section>
    ) : null;

  // Plain AGL readout only when there's no altitude rail (small size). The rail
  // is the altitude carrier everywhere else.
  const heightEl = !showRail ? (
    <Section>
      <SectionTitle>Height</SectionTitle>
      <Grid cols="auto 1fr" gap="xs">
        <GridCellPair label="AGL">
          {<Metres m={heightFromTerrain} />}
        </GridCellPair>
      </Grid>
      {/* The CoM-datum caveat is carried once by `comDatumNote` (in the detail
          stack / right column), so it isn't repeated here. */}
    </Section>
  ) : null;

  const divertEl =
    !landed && !noLandingVector && vs?.targetDistance != null ? (
      <Section>
        <SectionTitle>Divert</SectionTitle>
        <Grid cols="auto 1fr" gap="xs">
          <GridCellPair label="Target range">
            {<Metres m={vs.targetDistance} />}
          </GridCellPair>
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
      landed={landed}
      noLandingVector={noLandingVector}
      impactSpeed={solution.bestSpeedAtImpact}
    />
  );

  // Everything that isn't the reticle: the cross-section, envelope, numbers +
  // notes, in the order they matter. Non-relevant fragments are null and drop
  // out. Used at sizes without the reticle (below the wide-size plots layout).
  const detailStack = (
    <Stack gap="sm">
      {crossSectionEl}
      {envelopeEl && (
        <div style={{ maxWidth: 240 }}>
          <SectionTitle>Descent envelope</SectionTitle>
          {envelopeEl}
        </div>
      )}
      {boardEl}
      {velocityEl}
      {readoutsStack}
      {comDatumNote}
      {heightEl}
      {divertEl}
    </Stack>
  );

  // The reticle is now svg-only so it aligns with the cross-section square; the
  // verdict banner + biome/terrain readout are composed here, below the plots.
  const reticleSquare = showReticle ? (
    <TouchdownReticle
      siteLat={landing?.predictedLatitude ?? null}
      siteLon={landing?.predictedLongitude ?? null}
      vesselLat={flight?.latitude ?? null}
      vesselLon={flight?.longitude ?? null}
      bodyRadius={body?.radius ?? null}
      slopeDeg={landing?.predictedSlopeAngle ?? null}
      biome={landing?.predictedBiome ?? null}
      sampleSource={landing?.sampleSource ?? null}
      terrainPatch={landing?.terrainPatch ?? null}
      terrainPatchSize={landing?.terrainPatchSize ?? null}
      spanMeters={reticleSpanMeters}
      zoneRadiusMeters={landingZoneRadiusM}
    />
  ) : null;

  // Site-hazard verdict (slope / roughness). When there's NO LANDING VECTOR the
  // site verdict is moot (you can't reach a safe touchdown ANYWHERE), so the
  // banner reads ABORT (not "DIVERT to a better patch", and never a green
  // "SAFE" that would contradict the alert hero above).
  const hazard = hazardVerdict.verdict;
  const bannerLabel = noLandingVector ? "ABORT" : (hazard ?? "NO SITE");
  const bannerTone: ReadoutTone =
    noLandingVector || hazard === "DIVERT"
      ? "alert"
      : hazard === "MARGINAL"
        ? "warning"
        : hazard === "SAFE"
          ? "go"
          : "default";
  const verdictBannerEl = showReticle ? (
    <div role="status" aria-live="polite">
      <StatusPill $tone={bannerTone}>{bannerLabel}</StatusPill>
    </div>
  ) : null;

  // Relief range (metres) for the terrain-scale cue.
  const reliefRange =
    landing?.terrainPatch && landing.terrainPatch.length > 0
      ? (() => {
          let lo = Number.POSITIVE_INFINITY;
          let hi = Number.NEGATIVE_INFINITY;
          for (const hgt of landing.terrainPatch) {
            if (!Number.isFinite(hgt)) continue;
            if (hgt < lo) lo = hgt;
            if (hgt > hi) hi = hgt;
          }
          return Number.isFinite(lo) && hi > lo ? hi - lo : null;
        })()
      : null;
  const sourceLabel =
    landing?.sampleSource === "predicted"
      ? "predicted"
      : landing?.sampleSource === "sub-vessel"
        ? "sub-vessel (est.)"
        : null;
  const terrainReadoutEl = showReticle ? (
    <Value tone="muted" size="xs">
      {landing?.predictedBiome ? `${landing.predictedBiome} · ` : ""}
      {landing?.predictedSlopeAngle != null
        ? `${landing.predictedSlopeAngle.toFixed(1)}° slope`
        : NULL_DISPLAY}
      {reliefRange != null && reliefRange >= 1
        ? ` · Δ ${Math.round(reliefRange)} m relief`
        : ""}
      {siteDrift != null
        ? ` · ${Math.round(siteDrift.distanceMeters)} m downrange`
        : ""}
      {sourceLabel ? ` · ${sourceLabel}` : ""}
    </Value>
  ) : null;

  return (
    <Panel
      panelTitle="LANDING"
      panelSubtitle={
        bodyName !== undefined
          ? `${bodyName}${atmospheric ? " · atmospheric" : " · vacuum"}`
          : undefined
      }
      // Host-derived now, so the hand-picked `vessel.surface` badge goes: the
      // panel watches every topic this widget declares instead of the one key
      // that hook chose.
      // The delay chrome belongs to the panel, not to the body. The regime and
      // the round trip used to be an internal "Delay" section with its own
      // heading, a second header inside a widget that already had one, sitting
      // above the readout it qualifies. They are the standing state of the link
      // rather than part of the descent readout, which is what the aside is for.
      panelAside={
        // The state and the round trip read left, where they sit naturally
        // beside the title; only the BADGES float right. A single right-aligned
        // block would drag the headline state over with it, which reads as a
        // right-aligned title rather than a left-to-right instrument line.
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            width: "100%",
          }}
        >
          {commitLayerEl}
          {clocks.roundTripSeconds != null && clocks.roundTripSeconds > 0 && (
            <Value tone="muted">
              RT {formatDuration(clocks.roundTripSeconds, { ms: true })}
            </Value>
          )}
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
            }}
          >
            <StatusPill $tone={REGIME_TONE[clocks.regime]}>
              {REGIME_LABEL[clocks.regime]}
            </StatusPill>
            <AugmentSlot name="landing-status.badges" props={badgesContext} />
          </span>
        </div>
      }
    >
      {board === "not-descending" && !landed ? (
        <EmptyState>No landing in progress</EmptyState>
      ) : (
        // The rail beside the content, both inside the panel's own body. This
        // used to bleed to the panel edge with `padding: 0` and every text band
        // paying its own inset, which is how the widget ended up with five
        // different insets and read tight. The body owns one inset now.
        <div
          ref={measureScroller}
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            alignItems: "stretch",
            // One rung up from space-8. This widget reads tight at close
            // quarters and the plots, rail and readouts all abut each other.
            gap: "var(--space-12)",
          }}
        >
          {showRail && (
            // Sticky, not scrolling. The rail is the instrument's spatial
            // spine: an altitude scale that slides out of view while the
            // readouts it indexes stay put is worse than useless. It sits in
            // the scrolling body (so it takes the panel inset like everything
            // else) but pins itself to the top of it. `align-self: flex-start`
            // is what lets sticky engage: a stretched flex child is already as
            // tall as the container and has nothing to stick within.
            <div
              style={{
                flex: "0 0 auto",
                // An instrument dimension, not a spacing rung: the width the
                // scale's labels and track need.
                width: 64,

                position: "sticky",
                top: 0,
                alignSelf: "flex-start",
                // The scroller's visible height, measured. Full display height
                // of the widget, so the scale spans what the operator can see
                // however far the readouts below it have scrolled.
                height: scrollerHeight > 0 ? scrollerHeight : undefined,
              }}
            >
              <AltitudeRail
                aglMeters={heightFromTerrain ?? null}
                ignitionAltitude={landed ? null : solution.ignitionAltitude}
                suicideBurnCountdown={
                  landed ? null : solution.suicideBurnCountdown
                }
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {showReticle ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {/* The plots in a shared FLEX-WRAP row: touchdown-site,
                    cross-section, and (on an atmospheric-aware board) the descent
                    envelope. Equal flex bases, so they lay out LANDSCAPE 3-across
                    when wide and degrade gracefully to 2-over-1 then a single
                    stacked column as width drops, no plot ever dropped. */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "var(--space-6)",
                    padding: "var(--space-8) 0",
                  }}
                >
                  <div style={{ flex: "1 1 200px", minWidth: 200 }}>
                    <SectionTitle>Touchdown site</SectionTitle>
                    {/* Flush: each plot SVG already insets its content by 4,
                        so the frame supplies the edge and lets that inset be
                        the gutter rather than stacking a second one. */}
                    <FramedDisplay>{reticleSquare}</FramedDisplay>
                  </div>
                  {crossSectionEl && (
                    <div style={{ flex: "1 1 200px", minWidth: 200 }}>
                      <SectionTitle>Cross-section</SectionTitle>
                      <FramedDisplay>{crossSectionEl}</FramedDisplay>
                    </div>
                  )}
                  {envelopeEl && (
                    <div style={{ flex: "1 1 200px", minWidth: 200 }}>
                      <SectionTitle>Descent envelope</SectionTitle>
                      <FramedDisplay>{envelopeEl}</FramedDisplay>
                    </div>
                  )}
                </div>
                {/* Readouts UNDERNEATH the plots (inset text): verdict banner,
                    terrain readout, then the numeric readout grid full-width. */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-12)",
                  }}
                >
                  {verdictBannerEl}
                  {terrainReadoutEl}
                  {boardEl}
                  {readoutsStack}
                  {comDatumNote}
                  {divertEl}
                </div>
              </div>
            ) : (
              detailStack
            )}
          </div>
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
    "dv.stages",
    "vessel.structure",
    "comms.delay",
  ],
  defaultConfig: {},
  augmentSlots: ["landing-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
