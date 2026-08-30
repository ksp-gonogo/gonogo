import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  type Reading,
  useProcessor,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  CommsDelaySource,
  type Value as Quantity,
  Situation,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Badge,
  Countdown,
  EmptyState,
  Grid,
  magnitudeOf,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  SectionTitle,
  Stack,
  StatusPill,
  Text,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlotBoard } from "../Plots/PlotBoard";
import { bodyAtIndex } from "../shared/streamBody";
import { AltitudeRail } from "./AltitudeRail";
import { deriveBoard } from "./board";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { deriveDelayClocks } from "./clocks";
// Side-effect import: the widget's OWN plots, registered into `plots` the same
// way any Uplink's would be. Pulled in here rather than left to the package
// entry's import order, because a widget that lost its own plot to a
// module-ordering accident would look like a telemetry outage.
import "./descentLayers";
import "./crossSectionPlot";
import "./touchdownReticlePlot";
import { greatCircle } from "./geo";
import { deriveHazardVerdict } from "./hazardVerdict";
import { solveSuicideBurn } from "./solveLanding";

// No config of its own; the empty type names the slot so adding one later
// doesn't change the registration's shape.
type LandingStatusConfig = Record<string, never>;

// Mounted by `Panel`'s universal segments rather than by this widget. The ids
// stay declared so a binder's component types against the propless contract
// rather than the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "landing-status.sections": Record<string, never>;
    "landing-status.actions": Record<string, never>;
  }
}

// ── Readouts ─────────────────────────────────────────────────────────────────
//
// Three of them, and each is `Unit` with this widget's precision on it, never
// a string formatter, which is what the unit system exists to stop: a widget
// that writes its own "m/s" is one rename away from disagreeing with every
// other readout on the dashboard about what a speed looks like.
//
// What is genuinely local is the PRECISION, and it is local for a reason a
// generic ladder cannot know: on a descent, ten metres of altitude is the
// difference between a landing and a crater, so the last kilometre is read to
// the metre while a hundred kilometres is read to a tenth of a kilometre.

/**
 * Accepts either shape while the migration is mid-flight, and PARAMETERISED by
 * unit, which is what this alias adds over ui-kit's own: the readouts below
 * take a length or a speed and nothing else, so a `Value<"m">` handed to `Mps`
 * is a compile error here. The unwrap itself is ui-kit's `magnitudeOf`.
 */
type Quantityish<U extends string> = Quantity<U> | number | null | undefined;

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
 * The four fields of a normalised stage row the rocket-equation solve needs.
 *
 * Structural rather than `DeltaVStage` itself so the tests below can hand it a
 * four-field literal: the solve is arithmetic on a mass ratio, and what it wants
 * is magnitudes. `NaN` for a field the wire did not carry, which every guard
 * below already rejects.
 */
interface StageLike {
  deltaVActual: number;
  deltaVVac: number;
  startMass: number;
  endMass: number;
}

/**
 * Active-engine burn parameters for the rocket-equation suicide-burn solve: the
 * effective exhaust velocity `ve` (= Isp·g0) and the burnout mass.
 *
 * PREFER the ACTIVE stage (the `DELTA_V_BUDGET` row matched to
 * `vessel.structure.currentStage`)
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
  active: StageLike | null | undefined,
  propulsion:
    | { totalMass?: Quantityish<"t">; dryMass?: Quantityish<"t"> }
    | undefined,
  totalDvActual: number | undefined,
  totalDvVac: number | undefined,
): { exhaustVelocity?: number; burnoutMass?: number } {
  if (active) {
    const dv = Number.isFinite(active.deltaVActual)
      ? active.deltaVActual
      : active.deltaVVac;
    const { startMass, endMass } = active;
    if (
      Number.isFinite(dv) &&
      dv > 0 &&
      Number.isFinite(startMass) &&
      Number.isFinite(endMass) &&
      startMass > endMass &&
      endMass > 0
    ) {
      return {
        exhaustVelocity: dv / Math.log(startMass / endMass),
        burnoutMass: endMass,
      };
    }
  }
  const dv = totalDvActual ?? totalDvVac;
  const totalMass = magnitudeOf(propulsion?.totalMass);
  const dryMass = magnitudeOf(propulsion?.dryMass);
  if (
    dv != null &&
    Number.isFinite(dv) &&
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
 * Read the one-way delay off `comms.delay`, or `null` when nothing has
 * established one.
 *
 * `null` means NO PATH and zero means a measured zero-distance link. The
 * contract is explicit about this (`command-delay.ts`: "null means NO PATH,
 * never a measured zero-distance delay. Never coerce it to 0"), and the
 * temptation is a `return 0` fallthrough that takes an absent field, a
 * malformed one and the backend's own "no path" null alike.
 *
 * `classifyRegime` reads a zero round trip as `live`, so the cost is a vessel
 * with no comms path rendering "T-1s SUICIDE BURN" behind a green LIVE badge:
 * a countdown an operator would burn on, asserted about a craft nothing can
 * reach. `CommitLayer`'s `no-path` arm expects this null: coercing here leaves
 * that arm reachable only by the whole payload being absent, and the two halves
 * of the design then disagree about which value means "no path".
 *
 * `CommsDelaySource.None` keeps its zero: that is a LAN loop with genuinely no
 * delay, the one place the number is a measurement rather than a fabrication.
 * A NEGATIVE delay is impossible, so it reads as unknown rather than as zero:
 * fabricating a live link is the one direction it must not fail in.
 */
function readOneWaySeconds(
  delay: { source?: number; oneWaySeconds?: Quantityish<"s"> } | undefined,
): number | null {
  if (!delay) return null;
  if (delay.source === CommsDelaySource.None) return 0;
  const s = magnitudeOf(delay.oneWaySeconds);
  if (s === null || s < 0) return null;
  return s;
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
      <Text tone={tone ?? "default"}>{children}</Text>
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
      <Text>{children}</Text>
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
const ATMO_PLOTS_ALT_GATE = 10_000; // metres AGL, the base unit a bare operand takes

/**
 * Air thin enough that the descent is effectively a vacuum one: below this,
 * drag does nothing a lander can plan around and the readout says so rather
 * than quoting four zeroes.
 */
const NEGLIGIBLE_DENSITY = 0.001; // kg/m³, the base unit a bare operand takes

/**
 * Whether the vessel is on the ground, and so has no descent left to evaluate.
 *
 * Taken off the `Situation` ORDINAL, and covering `PreLaunch` as well as
 * `Landed`. Comparing the enum NAME against the single literal "Landed" is what
 * a craft on the pad fails: every vessel is `PreLaunch` until the clamps
 * release, and a stationary craft whose centre of mass sits a few metres above
 * the terrain datum still solves to a finite free-fall time-to-impact, so the
 * pad runs a live descent evaluation, counting down to a commit point and a
 * blind moment for a rocket that has not moved. `Splashed` is here for the same
 * reason, and matches the ordinal-derived
 * `isSplashed` this verdict sits beside.
 *
 * An absent or unrecognized situation is not a verdict either way: it yields
 * false, and the caller falls back to its other grounded signals rather than
 * asserting a descent nothing reported.
 */
export function isGroundedSituation(
  situation: number | null | undefined,
): boolean {
  return (
    situation === Situation.Landed ||
    situation === Situation.Splashed ||
    situation === Situation.PreLaunch
  );
}

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const [measureScroller, scrollerHeight] = useScrollerHeight();

  const vs = useStream<VesselState>("vessel.state");
  const bodyName = vs?.parentBodyName ?? undefined;

  const identityReading = useTelemetry("vessel.identity");
  const bodiesReading = useTelemetry("system.bodies");
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

  // Which situation the vessel is in does not decay the way a velocity does: a
  // craft that was on the pad when the last frame arrived has not since taken
  // off down a link that stopped delivering, so `describe` is the right read.
  const identity = describe(identityReading);
  const flight = describe(flightReading);
  const surface = describe(surfaceReading);
  const propulsion = describe(propulsionReading);
  const orbit = describe(orbitReading);
  const landing = describe(landingReading);
  /*
   * The parent body, resolved off `system.bodies` by INDEX rather than looked
   * up by name in the bundled table of stock bodies. Under a planet pack the
   * names do not match: RSS calls Kerbin "Earth", the lookup misses, and this
   * board reported "no body data" and a VACUUM descent for a reentry through
   * an atmosphere. The table stays behind it for the presentation the stream
   * carries nothing for.
   */
  const body = bodyAtIndex(describe(bodiesReading), identity?.parentBodyIndex);
  const atmospheric = body?.hasAtmosphere ?? false;
  // The one shared ΔV derivation. It already carries a dated budget rather than
  // blanking one, which is the arm policy `describe` gives every other read here.
  const budget = useProcessor(DELTA_V_BUDGET);
  const structureReading = useTelemetry("vessel.structure");
  const commsDelayReading = useTelemetry("comms.delay");
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
    budget?.activeStage,
    propulsion,
    budget?.totalActual?.magnitude,
    budget?.totalVac?.magnitude,
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

  // On the ground: a grounded vessel can still report a residual altitude and a
  // stale time-to-impact, so gate the descent clocks on the SITUATION rather
  // than on the impact figure. `vessel.surface.landedAt` (the site KSP records
  // a vessel as being down at) is the direct signal; the situation ordinal and
  // the splashed flag back it up where a source populates those instead.
  const landed =
    surface?.landedAt != null ||
    isGroundedSituation(identity?.situation) ||
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

  const availableDv = budget?.totalActual ?? budget?.totalVac ?? undefined;
  const requiredDv = solution.burnDeltaV;
  const affordable =
    requiredDv != null && availableDv != null
      ? availableDv.greaterThanOrEqual(requiredDv)
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

  // `no-path` is deliberately NOT folded in here. `classifyRegime` goes out of
  // its way to refuse to call an unknown link live, and folding `no-path` in
  // here throws that away one line later: with no comms telemetry at all the
  // hero would read "SUICIDE BURN", which is a claim that the loop is closed.
  // CommitLayer has its own arm for a link it cannot vouch for.
  const live = clocks.regime === "live";
  const width = w ?? 8;
  // The flight instruments (velocity vector + TWR) and the full-height altitude
  // rail come in together at a comfortable width; below that, plain readouts.
  const showScope = width >= 6;
  /**
   * Whether this widget lays plots out at all, which is the ONLY plot decision
   * left to it: below this width a plot is narrower than it is legible and the
   * readouts are the better use of the space. It says nothing about WHICH plots
   * exist, and cannot: each decides that for itself and the board arranges what
   * comes back.
   */
  const showPlots = width >= 8;
  /**
   * The altitude RAIL, which is not a plot and is deliberately not one.
   *
   * It was briefly a contribution to `plots`, and that was wrong twice over: a
   * chart of a single scalar is one chevron on a ladder, and the widget already
   * states the same height a few pixels away. It is a gauge, so it is chrome,
   * and the rule was that every PLOT goes through the slot rather than every
   * instrument. Nothing else on the board draws height against a scale, so it
   * duplicates nothing.
   */
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
    heightFromTerrain.lessThan(ATMO_PLOTS_ALT_GATE);
  const atmosphericPlotsShown =
    atmospheric &&
    landing?.sampleSource != null &&
    (predictionStable || lowApproach);
  /**
   * Whether the SITE readouts beside the plots have a site to describe. Not a
   * plot gate any more: the reticle decides for itself whether it is relevant,
   * and this is the verdict banner and the biome/terrain line, which are text
   * this widget owns.
   */
  const siteReadoutsShown =
    showPlots &&
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

  // TWR is its own widget. It was here because a descent wants it, but a
  // dashboard that wants it can place the TWR widget beside this one, and
  // carrying a second copy cost this panel a whole band of vertical space it
  // needs for the plots.

  // Contributed plots. This widget names none of them and derives nothing for
  // them: each decides for itself whether it has anything to say this frame and
  // what to say it against, and the board lays out whatever comes back. The
  // descent envelope that used to be composed here by hand is one of them now.
  const contributedPlots = <PlotBoard />;

  const comDatumNote = usingComDatum ? (
    <Text tone="muted" size="xs">
      centre-of-mass altitude (lowest-point datum unavailable)
    </Text>
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
            <Text tone="muted">n/a · no path</Text>
          ) : affordable == null ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
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
        <Text tone="muted" size="xs">
          est · current config
          {landing?.parachuteState === "armed" ? " · excludes chute" : ""}
        </Text>
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
            {flight?.atmDensity == null || !flight.atmDensity.isFinite() ? (
              NULL_DISPLAY
            ) : flight.atmDensity.lessThan(NEGLIGIBLE_DENSITY) ? (
              "negligible"
            ) : (
              <Unit value={flight.atmDensity} decimals={3} />
            )}
          </GridCellPair>
        </Grid>
        <Text tone="muted" size="xs">
          {flight?.atmDensity != null &&
          flight.atmDensity.lessThan(NEGLIGIBLE_DENSITY)
            ? "negligible drag · near free-fall, terminal velocity resolves as air thickens"
            : "above terminal · drag building, terminal velocity resolves as descent continues"}
        </Text>
      </Section>
    ) : board === "atmospheric-unmodelled" ? (
      <Section>
        <Text tone="muted" size="xs">
          descent in atmosphere · no terrain model (no body data)
        </Text>
      </Section>
    ) : board === "no-solution" ? (
      <Section>
        <Text tone="muted">no solution · no body data</Text>
      </Section>
    ) : null;

  const velocityEl =
    // The atmospheric-estimate board carries its own velocity split, so don't
    // repeat it in the standalone Velocity section.
    //
    // It used to be suppressed whenever the spatial plots were up, on the
    // grounds that the cross-section's own label carried the split. That was
    // only ever true when a terrain patch had shipped: without one the
    // cross-section now contributes no plot at all, and the split was left
    // being reported by nothing. A readout is this widget's own text, so
    // whether some plot happens to restate it is not a question it should be
    // answering, and answering it is how the number went missing.
    board !== "atmospheric-estimate" && solution.horizontalSpeed != null ? (
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

  // Everything that isn't a plot: the numbers + notes, in the order they
  // matter. Non-relevant fragments are null and drop out. Used at sizes below
  // the wide-size plots layout.
  const detailStack = (
    <Stack gap="sm">
      {contributedPlots}
      {boardEl}
      {velocityEl}
      {readoutsStack}
      {comDatumNote}
      {heightEl}
      {divertEl}
    </Stack>
  );

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
  const verdictBannerEl = siteReadoutsShown ? (
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
  const terrainReadoutEl = siteReadoutsShown ? (
    <Text tone="muted" size="xs">
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
    </Text>
  ) : null;

  return (
    <Panel
      panelTitle="LANDING"
      // Host-derived, so there is no hand-picked `vessel.surface` badge: the
      // panel watches every topic this widget declares rather than one chosen
      // key.
      // The delay chrome belongs to the panel, not to the body. The regime and
      // the round trip are the standing state of the LINK rather than part of
      // the descent readout, which is what the aside is for; carrying them in
      // the body means a second heading inside a widget that already has one,
      // sitting above the readout it qualifies.
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
            <Text tone="muted">
              RT <Countdown value={clocks.roundTripSeconds} precise />
            </Text>
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
          </span>
        </div>
      }
    >
      {bodyName !== undefined && (
        <Text tone="muted" size="xs">
          {`${bodyName}${atmospheric ? " · atmospheric" : " · vacuum"}`}
        </Text>
      )}
      {/* The board is DESCRIBED, not suspended. No `role="status"`: the hero below
          already owns one, and a second live region on the same panel floods a
          screen reader rather than informing it. `isDated` rather than
          "not observed", so a cold start says nothing at all: "described from last
          known" is a lie when nothing has ever arrived. It stays on screen with a caption
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
        // The rail beside the content, both inside the panel's own body, which
        // owns the single inset. Bleeding to the panel edge with `padding: 0`
        // makes every text band pay its own inset, which is how a widget ends
        // up with five different ones and reads tight.
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
            {showPlots ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {/* Every plot on this widget, arranged and nothing more. No
                    `FramedDisplay` around it: a contributed plot's chart owns
                    its own frame and a second one reads as a double border. */}
                <div style={{ padding: "var(--space-8) 0" }}>
                  {contributedPlots}
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
                  {velocityEl}
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
  // This widget HOSTS plots. Declaring the slot is the whole of the opt-in, and
  // it is an opt-in rather than a framework universal because a plot is not
  // something every widget has room for. Its own descent envelope arrives
  // through here like anyone else's (see `descentLayers.ts`); no augment slot.
  contributionSlots: ["plots"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
