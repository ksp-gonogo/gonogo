import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  CommsDelaySource,
  type Value as Quantity,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  Countdown,
  EmptyState,
  FramedDisplay,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  SectionTitle,
  Stack,
  StatusPill,
  Unit,
  Value,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ── Readouts ─────────────────────────────────────────────────────────────────
//
// Three of them, and each is `Unit` with this widget's precision on it. They
// used to be string formatters, which is what the unit system exists to stop:
// a widget that writes its own "m/s" is one rename away from disagreeing with
// every other readout on the dashboard about what a speed looks like.
//
// What is genuinely local is the PRECISION, and it is local for a reason a
// generic ladder cannot know: on a descent, ten metres of altitude is the
// difference between a landing and a crater, so the last kilometre is read to
// the metre while a hundred kilometres is read to a tenth of a kilometre.

/** Accepts either shape while the migration is mid-flight. */
type Quantityish<U extends string> = Quantity<U> | number | null | undefined;

function magnitudeOf(v: Quantityish<string>): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n === null || n === undefined || !Number.isFinite(n) ? null : n;
}

/** A speed, read finer the slower it is: a touchdown is decided in cm/s. */
function Mps({ v }: { v: Quantityish<"m/s"> }) {
  const n = magnitudeOf(v);
  if (n === null) return NULL_DISPLAY;
  const abs = Math.abs(n);
  return (
    <Unit
      value={value("m/s", n)}
      format="m/s"
      decimals={abs < 10 ? 2 : abs < 100 ? 1 : 0}
    />
  );
}

/** An altitude or a distance, on the shared length ladder. */
function Metres({ m }: { m: Quantityish<"m"> }) {
  const n = magnitudeOf(m);
  if (n === null) return NULL_DISPLAY;
  const abs = Math.abs(n);
  return (
    <Unit
      value={value("m", n)}
      decimals={abs >= 10_000 ? 1 : abs >= 1000 ? 2 : 0}
    />
  );
}

/** A delta-v budget. Always whole m/s: nobody plans a burn to the centimetre. */
function Dv({ v }: { v: Quantityish<"m/s"> }) {
  const n = magnitudeOf(v);
  if (n === null) return NULL_DISPLAY;
  return <Unit value={value("m/s", n)} format="m/s" decimals={0} />;
}

/**
 * The five fields of a `dv.stages` entry the rocket-equation solve needs.
 *
 * Structural rather than the contract type, and it takes either shape, so the
 * tests below can hand it plain numbers: the solve is arithmetic on a mass
 * ratio, and what it wants is magnitudes.
 */
interface StageLike {
  stage?: number;
  dvActual?: Quantityish<"m/s">;
  dvVac?: Quantityish<"m/s">;
  startMass?: Quantityish<"t">;
  endMass?: Quantityish<"t">;
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
  propulsion:
    | { totalMass?: Quantityish<"t">; dryMass?: Quantityish<"t"> }
    | undefined,
  summary:
    | { totalDvActual?: Quantityish<"m/s">; totalDvVac?: Quantityish<"m/s"> }
    | undefined,
): { exhaustVelocity?: number; burnoutMass?: number } {
  const active = stages?.find((s) => s.stage === currentStage);
  if (active) {
    const dv = magnitudeOf(active.dvActual) ?? magnitudeOf(active.dvVac);
    const startMass = magnitudeOf(active.startMass);
    const endMass = magnitudeOf(active.endMass);
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
  const dv =
    magnitudeOf(summary?.totalDvActual) ?? magnitudeOf(summary?.totalDvVac);
  const totalMass = magnitudeOf(propulsion?.totalMass);
  const dryMass = magnitudeOf(propulsion?.dryMass);
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
  delay: { source?: number; oneWaySeconds?: Quantityish<"s"> } | undefined,
): number | null {
  if (!delay) return null;
  if (delay.source === CommsDelaySource.None) return 0;
  const s = magnitudeOf(delay.oneWaySeconds);
  return s !== null && s >= 0 ? s : 0;
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
/**
 * Air thin enough that the descent is effectively a vacuum one: below this,
 * drag does nothing a lander can plan around and the readout says so rather
 * than quoting four zeroes.
 */
const NEGLIGIBLE_DENSITY = 0.001; // kg/m³
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

  const flightReading = useTelemetry("vessel.flight");
  const surfaceReading = useTelemetry("vessel.surface");
  const propulsionReading = useTelemetry("vessel.propulsion");
  const orbitReading = useTelemetry("vessel.orbit");
  const landingReading = useTelemetry("vessel.landing");

  /**
   * Describe from the best value available; instruct only from a current one.
   *
   * This replaces "the whole board suspends", which was the wrong call for the
   * reason the case itself makes obvious: losing contact mid-descent is the
   * EXPECTED case, not an edge one, and a blank board during a descent nobody is
   * tracking is the worst of the available answers.
   *
   * The split is not by field but by what the operator DOES with the number:
   *
   * - a DESCRIPTION (altitude, velocity, how much delta-v there was) renders from a
   *   modelled or last-known value, labelled as such. It stays useful when dated,
   *   and blanking it throws away the only picture there is
   * - an INSTRUCTION (the suicide-burn instant, the ignition countdown) does not
   *   render from a reckoned state at all. The number IS the act: an operator burns
   *   on it at a named moment, and a modelled ignition time is a wrong instruction
   *   rather than a stale reading
   *
   * `describe` takes the reckoned value where one exists, because a propagated
   * descent state is genuinely better than the last observed one. `instruct` demands
   * `observed`, which is the whole distinction.
   */
  const describe = <T,>(r: Reading<T>): T | undefined =>
    r.state === "observed"
      ? r.value
      : r.state === "reckonable"
        ? r.reckoned.value
        : r.state === "stale"
          ? r.value
          : undefined;

  const flight = describe(flightReading);
  const surface = describe(surfaceReading);
  const propulsion = describe(propulsionReading);
  const orbit = describe(orbitReading);
  const landing = describe(landingReading);
  const summaryReading = useTelemetry("dv.summary");
  const dvStagesReading = useTelemetry("dv.stages");
  const structureReading = useTelemetry("vessel.structure");
  const commsDelayReading = useTelemetry("comms.delay");
  const summary = describe(summaryReading);
  const dvStages = describe(dvStagesReading);
  const structure = describe(structureReading);
  const commsDelay = describe(commsDelayReading);

  /**
   * Whether the board is DESCRIBING rather than reporting, and which readings put it
   * there. Drives a caption, never a blank: the numbers below are still the best
   * picture available and stay on screen.
   */
  const isDated = (r: Reading<unknown>): boolean =>
    r.state === "stale" || r.state === "reckonable";
  const datedInputs = [
    isDated(flightReading) ? "flight" : null,
    isDated(surfaceReading) ? "surface" : null,
    isDated(propulsionReading) ? "propulsion" : null,
    isDated(orbitReading) ? "orbit" : null,
    isDated(landingReading) ? "landing" : null,
  ].filter((name): name is string => name !== null);
  /**
   * The gate on the INSTRUCTION half: no input the burn solve rests on may be DATED.
   *
   * Keyed on dated rather than on "every input is observed", which is what I wrote
   * first and which the snapshot fixtures caught. A never-arrived input is not a
   * reason to refuse: a scenario that carries no `vessel.landing` at all still has a
   * nameable ignition instant, and `solveSuicideBurn` already answers
   * "not-descending" when it genuinely lacks data. Refusing there would have
   * withheld the countdown on every board that simply does not carry every topic.
   */
  const mayInstruct = datedInputs.length === 0;

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
    heightFromTerrain: heightFromTerrain?.magnitude,
    altitudeAsl: flight?.altitudeAsl?.magnitude,
    verticalSpeed: flight?.verticalSpeed?.magnitude,
    surfaceSpeed: flight?.surfaceSpeed?.magnitude,
    mu: orbit?.mu?.magnitude,
    bodyRadius: body?.radius,
    availableThrust: propulsion?.availableThrust?.magnitude,
    totalMass: propulsion?.totalMass?.magnitude,
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
      ? requiredDv <= availableDv.magnitude
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
  const currentVs = flight?.verticalSpeed?.magnitude;
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
  // Magnitudes, because these are effect dependencies as well as geometry
  // inputs: a `Value` is a fresh object every frame, so depending on one
  // re-runs the effect on every tick even when the prediction has not moved.
  const predLat = landing?.predictedLatitude?.magnitude;
  const predLon = landing?.predictedLongitude?.magnitude;
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

  // `no-path` is deliberately NOT folded in here. `classifyRegime` goes out of
  // its way to refuse to call an unknown link live, and this used to throw that
  // away one line later: with no comms telemetry at all the hero read
  // "SUICIDE BURN", which is a claim that the loop is closed. CommitLayer has
  // its own arm for a link it cannot vouch for.
  const live = clocks.regime === "live";
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
    heightFromTerrain != null &&
    heightFromTerrain.magnitude < ATMO_PLOTS_ALT_GATE;
  const atmosphericPlotsShown =
    atmospheric &&
    landing?.sampleSource != null &&
    (predictionStable || lowApproach);
  const showReticle =
    width >= 8 &&
    landing?.sampleSource != null &&
    (!atmospheric || atmosphericPlotsShown);
  const hazardVerdict = deriveHazardVerdict({
    slopeDeg: landing?.predictedSlopeAngle?.magnitude,
    roughnessSigma: landing?.predictedRoughness?.magnitude,
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
          flight.latitude.magnitude,
          flight.longitude.magnitude,
          landing.predictedLatitude.magnitude,
          landing.predictedLongitude.magnitude,
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
    ? (landing?.atmosphericTimeToImpact?.magnitude ?? null)
    : solution.timeToImpact;
  const landingZoneRadiusM =
    landing?.sampleSource != null
      ? Math.max(
          landing?.roughnessFootprintMeters?.magnitude ?? 0,
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

  // The terrain profile as bare metres. Both plots sample it into a polyline,
  // so the unit comes off once here rather than per point per frame: the patch
  // runs to a few hundred readings and both plots redraw on every tick.
  const terrainPatchMeters = useMemo(
    () => landing?.terrainPatch?.map((h) => h.magnitude) ?? null,
    [landing?.terrainPatch],
  );

  // The side-on cross-section plot (terrain profile along the ground track +
  // the velocity vector in the vertical plane), paired with the top-down reticle.
  const crossSectionEl = scopeShown ? (
    <CrossSection
      patch={terrainPatchMeters}
      patchSize={landing?.terrainPatchSize?.magnitude ?? null}
      bearingDeg={driftBearingDeg}
      verticalSpeed={solution.verticalSpeed}
      horizontalSpeed={solution.horizontalSpeed}
      aglMeters={heightFromTerrain?.magnitude ?? null}
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
        currentSpeed={flight?.surfaceSpeed?.magnitude ?? null}
        currentAltitude={heightFromTerrain?.magnitude ?? null}
        terminalVelocity={landing?.terminalVelocity?.magnitude ?? null}
        projectedTouchdownSpeed={
          landing?.projectedTouchdownSpeed?.magnitude ?? null
        }
        atmosphereColor={body?.atmosphereColor ?? null}
        dragToWeight={landing?.dragToWeightRatio?.magnitude ?? null}
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
        {<Mps v={flight?.surfaceSpeed ?? solution.horizontalSpeed} />}
      </StackedField>
      <StackedField label="Fuel remaining">
        {<Dv v={availableDv} />}
      </StackedField>
    </Grid>
  ) : board === "vacuum-solved" ? (
    // Under NO LANDING VECTOR every number here (burn dV you can afford, dV in
    // the tank, coast speed) is moot context, not a positive: dim the whole
    // grid so it can't read as reassurance against the ABORT hero above.
    <div style={noLandingVector ? { opacity: 0.5 } : undefined}>
      <Grid minColWidth="130px" gap="sm">
        <StackedField label="Burn dV">{<Dv v={requiredDv} />}</StackedField>
        <StackedField label="Burn duration">
          {solution.burnDuration == null ? (
            NULL_DISPLAY
          ) : (
            <Countdown value={solution.burnDuration} precise />
          )}
        </StackedField>
        <StackedField label="Available dV">
          {<Dv v={availableDv} />}
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
            <Badge severity={affordable ? "nominal" : "critical"} size="sm">
              {affordable ? "yes" : "insufficient dV"}
            </Badge>
          )}
        </div>
        <StackedField label="Touchdown (coast)">
          {<Mps v={solution.speedAtImpact} />}
        </StackedField>
        <StackedField label="Touchdown (burn now)">
          {solution.bestSpeedAtImpact == null ? (
            NULL_DISPLAY
          ) : (
            <Mps v={solution.bestSpeedAtImpact} />
          )}
        </StackedField>
        <StackedField label="Impact in">
          {landed || solution.timeToImpact == null ? (
            NULL_DISPLAY
          ) : (
            <Countdown value={solution.timeToImpact} precise />
          )}
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
            {<Mps v={landing?.terminalVelocity} />}
          </GridCellPair>
          <GridCellPair label="Touchdown">
            {<Mps v={landing?.projectedTouchdownSpeed} />}
          </GridCellPair>
          <GridCellPair label="Impact in">
            {landing?.atmosphericTimeToImpact == null ? (
              NULL_DISPLAY
            ) : (
              <Countdown value={landing.atmosphericTimeToImpact} precise />
            )}
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
            {<Mps v={solution.verticalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {<Mps v={solution.horizontalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Air density">
            {flight?.atmDensity == null ||
            !Number.isFinite(flight.atmDensity.magnitude) ? (
              NULL_DISPLAY
            ) : flight.atmDensity.magnitude < NEGLIGIBLE_DENSITY ? (
              "negligible"
            ) : (
              <Unit value={flight.atmDensity} decimals={3} />
            )}
          </GridCellPair>
        </Grid>
        <Value tone="muted" size="xs">
          {flight?.atmDensity != null &&
          flight.atmDensity.magnitude < NEGLIGIBLE_DENSITY
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
            {<Mps v={solution.verticalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {<Mps v={solution.horizontalSpeed} />}
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
      mayInstruct={mayInstruct}
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
      siteLat={landing?.predictedLatitude?.magnitude ?? null}
      siteLon={landing?.predictedLongitude?.magnitude ?? null}
      vesselLat={flight?.latitude?.magnitude ?? null}
      vesselLon={flight?.longitude?.magnitude ?? null}
      bodyRadius={body?.radius ?? null}
      slopeDeg={landing?.predictedSlopeAngle?.magnitude ?? null}
      biome={landing?.predictedBiome ?? null}
      sampleSource={landing?.sampleSource ?? null}
      terrainPatch={terrainPatchMeters}
      terrainPatchSize={landing?.terrainPatchSize?.magnitude ?? null}
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
          for (const { magnitude: hgt } of landing.terrainPatch) {
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
      {landing?.predictedSlopeAngle != null ? (
        <>
          <Unit value={landing.predictedSlopeAngle} decimals={1} /> slope
        </>
      ) : (
        NULL_DISPLAY
      )}
      {reliefRange != null && reliefRange >= 1
        ? ` · Δ ${writeQuantity(value("m", reliefRange), { decimals: 0 })} relief`
        : ""}
      {siteDrift != null
        ? ` · ${writeQuantity(value("m", siteDrift.distanceMeters), { decimals: 0 })} downrange`
        : ""}
      {sourceLabel ? ` · ${sourceLabel}` : ""}
    </Value>
  ) : null;

  return (
    <Panel
      panelTitle="LANDING"
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
              RT <Countdown value={clocks.roundTripSeconds} precise />
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
      {bodyName !== undefined && (
        <Value tone="muted" size="xs">
          {`${bodyName}${atmospheric ? " · atmospheric" : " · vacuum"}`}
        </Value>
      )}
      {/* The board is DESCRIBED, not suspended. No `role="status"`: the hero below
          already owns one, and a second live region on the same panel floods a
          screen reader rather than informing it. `isDated` rather than
          "not observed", so a cold start says nothing at all: "described from last
          known" is a lie when nothing has ever arrived, which is the exact
          conflation this whole workstream exists to stop. It stays on screen with a caption
          naming which readings are no longer current, because losing contact
          mid-descent is the expected case and a blank board is the worst answer
          available. The ignition instant is refused separately, in CommitLayer. */}
      {datedInputs.length > 0 && (
        <ReadoutCaption>
          {`Described from last known ${datedInputs.join(", ")}, not current`}
        </ReadoutCaption>
      )}
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
                aglMeters={heightFromTerrain?.magnitude ?? null}
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
    "Composed descent instrument for landing under signal delay: a full-height altitude rail, two altimetry plots (top-down touchdown reticle + side-on terrain cross-section with the velocity vector), and delay-native commit/uncommandable clocks with the suicide-burn cue. An instrument, not a command surface (fly gear/brakes from action-group widgets; TWR is its own widget, place it alongside this one).",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 12 },
  minSize: { w: 4, h: 6 },
  component: LandingStatusComponent,
  dataRequirements: [
    // `vessel.state` is a DERIVED channel read wholesale via useStream. Its
    // raw inputs are listed below because carrying them is what carries it,
    // but the channel itself has to be named too: alarm attribution matches an
    // alarm's subject field against what the widget declares, and every
    // descent alarm (`land.timeToImpact` and friends) resolves to a
    // `vessel.state.*` field that none of those inputs contains. Without this
    // line no alarm could reach this widget at all.
    "vessel.state",
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
