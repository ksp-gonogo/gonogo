import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  type ReadingState,
  type ReckonableReading,
  type TopicReading,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  bandIn,
  type Value as Quantity,
  readingOf,
  Situation,
  type Vec3Of,
  type VesselFlight,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Badge,
  Band,
  bandClaim,
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
import { DescribedFromLastKnown } from "../shared/DescribedFromLastKnown";
import { bare, vecMagnitude } from "../shared/dockAngles";
import { bodyAtIndex } from "../shared/streamBody";
import { AltitudeRail } from "./AltitudeRail";
import { deriveBoard } from "./board";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { deriveDelayClocks } from "./clocks";
// The widget's own plots, registered into `plots` like any Uplink's; imported here so no module ordering can drop them.
import "./descentLayers";
import "./crossSectionPlot";
import "./touchdownReticlePlot";
import { useBodyName } from "../shared/useBodyName";
import { greatCircle } from "./geo";
import { deriveHazardVerdict } from "./hazardVerdict";
import { solveSuicideBurn } from "./solveLanding";

type LandingStatusConfig = Record<string, never>;

// Mounted by Panel's universal segments; declared so a binder types against the propless contract.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "landing-status.sections": Record<string, never>;
    "landing-status.actions": Record<string, never>;
  }
}

// Readouts use `Unit` with this widget's own precision: on a descent the last kilometre is read to the metre.
/** Either shape while the migration is mid-flight, parameterised by unit so a length handed to `Mps` is a compile error. */
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

const ONE_KM = value("m", 1000);
const TEN_KM = value("m", 10_000);

/** This widget's precision ladder for a height, shared by the AGL and ASL readouts; the rungs compare as lengths, not bare numbers. */
function altitudeDecimals(m: Quantity<"m">): number {
  const abs = m.abs();
  return abs.greaterThanOrEqual(TEN_KM)
    ? 1
    : abs.greaterThanOrEqual(ONE_KM)
      ? 2
      : 0;
}

/** An altitude or a distance, on the shared length ladder. */
function Metres({ m }: { m: Quantityish<"m"> }) {
  const n = magnitudeOf(m);
  if (n === null) return NULL_DISPLAY;
  const height = value("m", n);
  return <Unit value={height} decimals={altitudeDecimals(height)} />;
}

/** A delta-v budget, in whole m/s. */
function Dv({ v }: { v: Quantityish<"m/s"> }) {
  const n = magnitudeOf(v);
  if (n === null) return NULL_DISPLAY;
  return <Unit value={value("m/s", n)} format="m/s" decimals={0} />;
}

/** The four stage fields the rocket-equation solve needs, structural so tests can pass a literal; `NaN` for a field the wire did not carry. */
interface StageLike {
  deltaVActual: number;
  deltaVVac: number;
  startMass: number;
  endMass: number;
}

/**
 * Active-engine burn parameters for the suicide-burn solve: effective exhaust velocity `ve` (Isp * g0) and burnout mass.
 *
 * Prefers the ACTIVE stage's `DELTA_V_BUDGET` row, since those engines fly the burn; the whole-vessel total averages engines of different Isp. Falls back to `dv.summary` plus `propulsion.dryMass` only without per-stage data (exact for a single-stage lander), and returns `{}` when nothing usable is on the wire.
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
 * The one-way delay off `comms.delay`, or `null` when nothing has established one.
 *
 * `null` means NO PATH and zero means a measured zero-distance link, so this never coerces: a coerced zero reads as `live` and shows a burn countdown for a craft nothing can reach. The VALUE decides, never `source`, since `CommsDelaySource.None` carries both a LAN zero and the no-path null. A negative delay is impossible and reads as unknown.
 */
function readOneWaySeconds(
  delay: { source?: number; oneWaySeconds?: Quantityish<"s"> } | undefined,
): number | null {
  if (!delay) return null;
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

/** The reading `vessel.flight` arrives as, spelled once so the readout and the widget body agree on the reckonable fields. */
export type FlightReading = ReckonableReading<
  VesselFlight,
  "altitudeAsl" | "orbitalSpeed"
>;

/**
 * Altitude above sea level: the last measurement, where the model puts it now, and how well it claims to know that.
 *
 * ASL is the quantity `vessel.flight` has a reckoner for; AGL has none, since a fitted rate says nothing about the terrain ahead. The observation stays the headline and is marked, never replaced, and the carried figure and interval appear only while the reading is not current.
 */
function CarriedAltitude({ reading }: { reading: FlightReading }) {
  const observed = readingOf(reading, (f) => f.altitudeAsl);
  const decimals =
    "value" in observed ? altitudeDecimals(observed.value) : undefined;
  const carrying = reading.state === "stale";
  // The field reading, which carries its own band and carried figure.
  const altitude = reading.altitudeAsl;
  const modelled =
    carrying && altitude.reckoning.status === "available"
      ? altitude.reckoning
      : undefined;
  const carried = modelled ? modelled.modelled : null;
  const band = bandIn(modelled?.band, "m");
  // Only while the reading is not current; on a live link the observation is now.
  const declined =
    carrying && reading.reckoning.status === "declined"
      ? reading.reckoning.declined
      : undefined;
  return (
    <Section title="Altitude ASL">
      <Grid cols="auto 1fr" gap="readout-row">
        {carrying ? (
          <GridCellPair label="Last observed">
            <Unit value={observed} decimals={decimals} />
          </GridCellPair>
        ) : (
          <Text style={{ gridColumn: "1 / -1" }}>
            <Unit value={observed} decimals={decimals} />
          </Text>
        )}
        {carrying && (
          <GridCellPair label="Carried to now">
            {carried === null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={carried} decimals={decimals} />
            )}
          </GridCellPair>
        )}
        {band && (
          <GridCellPair label="Known to">
            <Band min={band.lo} max={band.hi} />
          </GridCellPair>
        )}
      </Grid>
      {band ? (
        <ReadoutCaption>
          {bandClaim(band.kind, "the carried altitude is inside that interval")}
        </ReadoutCaption>
      ) : declined ? (
        <ReadoutCaption>{declined.note ?? declined.reason}</ReadoutCaption>
      ) : carried !== null ? (
        <ReadoutCaption>
          carried with no interval: this model bounds nothing
        </ReadoutCaption>
      ) : null}
    </Section>
  );
}

/** A caption over its value, for the reticle's narrow side column where side by side would wrap. */
function StackedField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Text>{children}</Text>
    </div>
  );
}

/**
 * The visible content height of the enclosing `Panel.Body`, and the callback ref that finds it.
 *
 * The rail spans the scroller's box, which no percentage expresses from inside a content-sized flex row. A callback ref, because the measured row mounts only once a descent streams, after a mount-time effect would have run.
 */
function useScrollerHeight(): [(node: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const box = node?.closest("[data-panel-body]");
    if (!(box instanceof HTMLElement)) return;
    // clientHeight is the padding box, and the rail lives in the content box.
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

// Atmospheric terrain plots appear only once the predicted touchdown has settled or the vessel is low: a jumpy high-altitude prediction is drag noise.
const PREDICTION_STABLE_M = 250; // predicted point moves < this per tick ⇒ settled
const ATMO_PLOTS_ALT_GATE = 10_000; // metres AGL, the base unit a bare operand takes

/** Air thin enough that the descent is effectively vacuum, so the readout says so rather than quoting zeroes. */
const NEGLIGIBLE_DENSITY = 0.001; // kg/m³, the base unit a bare operand takes

/**
 * Whether the vessel is on the ground and has no descent left to evaluate, off the `Situation` ordinal.
 *
 * `PreLaunch` and `Splashed` count, since a pad craft slightly above the terrain datum still solves to a finite time-to-impact. An absent or unrecognised situation yields false, and the caller falls back to its other grounded signals.
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

  // Range to the target, measured with the same pair `Targeting` uses so the two widgets agree.
  const targetReading = useStream<{ relativePosition?: Vec3Of<"m"> }>(
    "vessel.target",
  );
  const targetStream =
    targetReading.state === "observed" || targetReading.state === "stale"
      ? targetReading.value
      : undefined;
  const targetRange = targetStream?.relativePosition
    ? vecMagnitude(bare(targetStream.relativePosition))
    : undefined;
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
   * - a DESCRIPTION (altitude, velocity, delta-v) renders from a modelled or last-known value, labelled as such
   * - an INSTRUCTION (the burn instant, the ignition countdown) never renders from a reckoned state: the operator acts on it at a named moment
   *
   * Losing contact mid-descent is the expected case, so the board is never blanked.
   */
  const describe = <T,>(r: TopicReading<T>): T | undefined =>
    r.reckoning.status === "available"
      ? r.reckoning.value
      : r.state === "observed" || r.state === "stale"
        ? r.value
        : undefined;

  /** The same policy for a contract-reckonable topic, overlaying the fields the model moves onto the observation; `reckoned.value` alone lacks every number the board descends on. */
  const describeReckonable = <T, K extends keyof T>(
    r: ReckonableReading<T, K>,
  ): T | undefined => {
    // `reckoning.status` narrows the reckoning, not the arm carrying it.
    if (r.state !== "observed" && r.state !== "stale") return undefined;
    return r.reckoning.status === "available"
      ? { ...r.value, ...r.reckoning.value }
      : r.value;
  };

  // A situation does not decay the way a velocity does, so `describe` is the right read.
  const identity = describe(identityReading);
  const bodyName = useBodyName(identity?.parentBodyIndex);
  const flight = describeReckonable(flightReading);
  const surface = describe(surfaceReading);
  const propulsion = describe(propulsionReading);
  // The conic moves the phase only, so this overlays like `vessel.flight`.
  const orbit = describeReckonable(orbitReading);
  const landing = describe(landingReading);
  // Resolved by index, not by name against the stock table, so a planet pack's renamed bodies still resolve.
  const body = bodyAtIndex(describe(bodiesReading), identity?.parentBodyIndex);
  const atmospheric = body?.hasAtmosphere ?? false;
  // A dated budget is still the best figure, and every readout from it is a figure rather than a control.
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const commsDelayReading = useTelemetry("comms.delay");
  // `oneWaySeconds` is carriable, so the model's projection is overlaid rather than taken whole.
  const commsDelay = describeReckonable(commsDelayReading);

  // Whether the board is describing rather than reporting, and which readings put it there; it drives a caption, never a blank.
  const isDated = (r: { state: ReadingState }): boolean => r.state === "stale";
  const datedInputs = [
    isDated(flightReading) ? "flight" : null,
    isDated(surfaceReading) ? "surface" : null,
    isDated(propulsionReading) ? "propulsion" : null,
    isDated(orbitReading) ? "orbit" : null,
    isDated(landingReading) ? "landing" : null,
  ].filter((name): name is string => name !== null);
  /**
   * The gate on the INSTRUCTION half: no input the burn solve rests on may be dated.
   * A never-arrived input does not refuse, since `solveSuicideBurn` already answers "not-descending" when it lacks data.
   */
  const mayInstruct = datedInputs.length === 0;
  // Target range is a description the burn does not rest on, so a held one joins the caption without refusing the instruction.
  const describedInputs = isDated(targetReading)
    ? [...datedInputs, "target"]
    : datedInputs;

  const { exhaustVelocity, burnoutMass } = deriveActiveBurnParams(
    budget?.activeStage,
    propulsion,
    budget?.totalActual?.magnitude,
    budget?.totalVac?.magnitude,
  );

  // The burn datum is the vessel's lowest point above terrain, falling back to CoM radar altitude with a note when `vessel.surface` is null.
  const surfaceHeight = surface?.heightFromTerrain;
  const heightFromTerrain = surfaceHeight ?? flight?.altitudeTerrain;
  const usingComDatum = surfaceHeight == null && heightFromTerrain != null;
  const aglReading =
    surfaceHeight != null
      ? readingOf(surfaceReading, (s) => s.heightFromTerrain ?? undefined)
      : readingOf(flightReading, (f) => f.altitudeTerrain);

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

  // Gated on the situation, not the impact figure, since a grounded vessel can report a residual altitude; `landedAt` is the direct signal.
  const landed =
    surface?.landedAt != null || isGroundedSituation(identity?.situation);

  const oneWaySeconds = readOneWaySeconds(commsDelay);
  const clocks = deriveDelayClocks({
    oneWaySeconds,
    suicideBurnCountdown: solution.suicideBurnCountdown,
    timeToImpact: solution.timeToImpact,
    landed,
  });

  // A vacuum solution exists but even the optimal burn hits at `bestSpeedAtImpact`, which is not the same as a nominal committed burn (0 means it fits).
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

  const atmosphereAware = landing?.terminalVelocity != null;
  const board = deriveBoard({
    solutionState: solution.state,
    atmospheric,
    atmosphereAware,
  });

  // A bounded vertical-speed history, so a developing over-speed reads as a trend.
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

  // How far the predicted touchdown moved since the last tick; settling is what makes an atmospheric site worth drawing.
  const prevPredictedRef = useRef<{ lat: number; lon: number } | null>(null);
  const [predictionMovement, setPredictionMovement] = useState<number | null>(
    null,
  );
  // Magnitudes, because a `Value` is a fresh object every frame and would re-run the effect each tick.
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

  // `no-path` is not live: with no comms telemetry at all the hero must not claim the loop is closed.
  const live = clocks.regime === "live";
  const width = w ?? 8;
  // Instruments and the altitude rail come in together at a comfortable width; below it, plain readouts.
  const showScope = width >= 6;
  // Below this width a plot is narrower than legible; each plot still decides for itself whether it exists.
  const showPlots = width >= 8;
  // The altitude rail is a gauge, so it is chrome rather than a contributed plot.
  const showRail = showScope;
  // On an atmospheric board the terrain plots wait for a settled prediction or a low vessel; on a vacuum board a sample is enough.
  const predictionStable =
    predictionMovement != null && predictionMovement < PREDICTION_STABLE_M;
  const lowApproach = heightFromTerrain?.lessThan(ATMO_PLOTS_ALT_GATE);
  const atmosphericPlotsShown =
    atmospheric &&
    landing?.sampleSource != null &&
    (predictionStable || lowApproach);
  // Whether the site text beside the plots (verdict banner, biome and terrain line) has a site to describe.
  const siteReadoutsShown =
    showPlots &&
    landing?.sampleSource != null &&
    (!atmospheric || atmosphericPlotsShown);
  /*
   * Every axis grades on its point estimate, with no band, because none exists: only `altitudeAsl` is banded on `vessel.flight`.
   * Vertical speed is not a reckonable field, and the lateral rate and slope come from the solve and `vessel.landing`.
   */
  const hazardVerdict = deriveHazardVerdict({
    slopeDeg: landing?.predictedSlopeAngle?.magnitude,
    roughnessSigma: landing?.predictedRoughness?.magnitude,
    verticalSpeed: solution.verticalSpeed,
    lateralSpeed: solution.horizontalSpeed,
    biome: landing?.predictedBiome,
  });
  // The velocity vector is meaningful only for a solved descent at width; once landed the scope stays as a touchdown view.
  const scopeShown =
    (board === "vacuum-solved" || landed || atmosphericPlotsShown) && showScope;

  // Sub-vessel to predicted site: the bearing slices the cross-section, the distance is the downrange readout.
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

  // Contributed plots: each decides for itself whether it has anything to say, and the board lays out what comes back.
  const contributedPlots = <PlotBoard />;

  const comDatumNote = usingComDatum ? (
    <Text tone="muted" size="xs">
      centre-of-mass altitude (lowest-point datum unavailable)
    </Text>
  ) : null;

  // `minColWidth` makes this one column in the narrow stack and a row full-width under the plots.
  const readoutsStack = landed ? (
    // Touchdown-confirmed readouts: how soft, how much fuel is left.
    <Grid minColWidth="130px" gap="related-dense">
      <StackedField label="Touchdown speed">
        {<Mps v={flight?.surfaceSpeed ?? solution.horizontalSpeed} />}
      </StackedField>
      <StackedField label="Fuel remaining">
        {<Dv v={availableDv} />}
      </StackedField>
    </Grid>
  ) : board === "vacuum-solved" ? (
    // Under NO LANDING VECTOR every number here is moot, so the grid dims rather than reading as reassurance against the ABORT.
    <div style={noLandingVector ? { opacity: 0.5 } : undefined}>
      <Grid minColWidth="130px" gap="related-dense">
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
            // A green "yes" would contradict the ABORT above, since fuel is not the wall.
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
        {targetRange !== undefined && (
          <StackedField label="Target range">
            {<Metres m={targetRange} />}
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
        <Grid cols="auto 1fr" gap="readout-row">
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
      // In atmosphere with no terminal velocity yet: show velocity, air density and that drag is still building, labelled as an estimate.
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="readout-row">
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
          {flight?.atmDensity?.lessThan(NEGLIGIBLE_DENSITY)
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
    // The atmospheric-estimate board carries its own velocity split; this readout is the widget's own text, so it never depends on a plot restating it.
    board !== "atmospheric-estimate" && solution.horizontalSpeed != null ? (
      <Section>
        <SectionTitle>Velocity</SectionTitle>
        <Grid cols="auto 1fr" gap="readout-row">
          <GridCellPair label="Vertical">
            {<Mps v={solution.verticalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {<Mps v={solution.horizontalSpeed} />}
          </GridCellPair>
        </Grid>
      </Section>
    ) : null;

  // ASL on any frame a payload has arrived; its interval appears once the link stops being current.
  const carriedAltitudeEl = flight ? (
    <CarriedAltitude reading={flightReading} />
  ) : null;

  // Plain AGL only when there is no altitude rail.
  const heightEl = !showRail ? (
    <Section>
      <SectionTitle>Height</SectionTitle>
      <Grid cols="auto 1fr" gap="readout-row">
        <GridCellPair label="AGL">
          {<Metres m={heightFromTerrain} />}
        </GridCellPair>
      </Grid>
    </Section>
  ) : null;

  const divertEl =
    !landed && !noLandingVector && targetRange !== undefined ? (
      <Section>
        <SectionTitle>Divert</SectionTitle>
        <Grid cols="auto 1fr" gap="readout-row">
          <GridCellPair label="Target range">
            {<Metres m={targetRange} />}
          </GridCellPair>
        </Grid>
      </Section>
    ) : null;

  const commitLayerEl = (
    <CommitLayer
      regime={clocks.regime}
      live={live}
      mayInstruct={mayInstruct}
      suicideBurnCountdown={solution.suicideBurnCountdown}
      commitInSeconds={clocks.commitInSeconds}
      committed={clocks.committed}
      landed={landed}
      noLandingVector={noLandingVector}
      impactSpeed={solution.bestSpeedAtImpact}
    />
  );

  // Everything that is not a plot, in the order it matters, below the wide plots layout.
  const detailStack = (
    <Stack>
      {contributedPlots}
      {boardEl}
      {velocityEl}
      {readoutsStack}
      {carriedAltitudeEl}
      {comDatumNote}
      {heightEl}
      {divertEl}
    </Stack>
  );

  /*
   * With NO LANDING VECTOR the banner reads ABORT, never DIVERT or a green SAFE.
   * UNRESOLVED takes the default tone: green would state a verdict and amber a site finding, when the finding is about the model.
   */
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
      // Host-derived: the panel watches every topic this widget declares.
      sections={[
        // The link state, first and full width: a delayed descent is flown by these countdowns, so a narrow tile must not fold them away.
        <Section key="link" full>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--gap-related)",
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
                gap: "var(--gap-related)",
              }}
            >
              <StatusPill $tone={REGIME_TONE[clocks.regime]}>
                {REGIME_LABEL[clocks.regime]}
              </StatusPill>
            </span>
          </div>
        </Section>,
        bodyName !== undefined || describedInputs.length > 0 ? (
          <Section key="context" full>
            {bodyName !== undefined && (
              <Text tone="muted" size="xs">
                {`${bodyName}${atmospheric ? " · atmospheric" : " · vacuum"}`}
              </Text>
            )}
            {/* No role="status": the hero owns the live region. Shown only for dated inputs, since a cold start has nothing "last known". */}
            <DescribedFromLastKnown readings={describedInputs} />
          </Section>
        ) : null,
        // The rail and its readouts take the height the captions leave.
        <Section key="descent" fill>
          {board === "not-descending" && !landed ? (
            <EmptyState>No landing in progress</EmptyState>
          ) : (
            // Rail and content sit inside the panel's own body, which owns the single inset.
            <div
              ref={measureScroller}
              style={{
                display: "flex",
                flex: 1,
                minHeight: 0,
                alignItems: "stretch",
                gap: "var(--gap-section)",
              }}
            >
              {showRail && (
                // Sticky, so the altitude scale stays in view while the readouts scroll; `align-self: flex-start` lets sticky engage.
                <div
                  style={{
                    flex: "0 0 auto",
                    // An instrument dimension: the width the scale's labels and track need.
                    width: 64,
                    position: "sticky",
                    top: 0,
                    alignSelf: "flex-start",
                    // The scroller's measured visible height, so the scale spans what the operator can see.
                    height: scrollerHeight > 0 ? scrollerHeight : undefined,
                  }}
                >
                  <AltitudeRail
                    agl={aglReading}
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
                    {/* No FramedDisplay: a contributed plot's chart owns its frame. */}
                    <div style={{ padding: "var(--inset-contributed-plots)" }}>
                      {contributedPlots}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--gap-section)",
                      }}
                    >
                      {verdictBannerEl}
                      {terrainReadoutEl}
                      {boardEl}
                      {velocityEl}
                      {readoutsStack}
                      {carriedAltitudeEl}
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
        </Section>,
      ]}
    />
  );
}

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
  // Declaring the slot is the whole opt-in; the widget's own descent envelope arrives through it too.
  contributionSlots: ["plots"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
