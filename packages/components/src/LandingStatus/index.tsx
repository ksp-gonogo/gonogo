import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import {
  Badge,
  Countdown,
  EmptyState,
  Panel,
  Section,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import { PlotBoard } from "../Plots/PlotBoard";
import { AltitudeRail } from "./AltitudeRail";
import { CarriedAltitude } from "./CarriedAltitude";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { DescentBoard } from "./DescentBoard";
import {
  ComDatumNote,
  DivertSection,
  HeightSection,
  VelocitySection,
} from "./DescentSections";
import { TerrainReadout, VerdictBanner } from "./SiteReadouts";
import { SolutionReadouts } from "./SolutionReadouts";
import { ATMOSPHERIC_SITE_GATE_M } from "./siteGate";
import { useLandingModel } from "./useLandingModel";
import { useScrollerHeight } from "./useScrollerHeight";
// The widget's own plots, registered into `plots` like any Uplink's; imported here so no module ordering can drop them.
import "./descentLayers";
import "./crossSectionPlot";
import "./touchdownReticlePlot";
import "./slots";
import { useLandingEssentials } from "./useLandingEssentials";

export type { FlightReading } from "./CarriedAltitude";

type LandingStatusConfig = Record<string, never>;

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const [measureScroller, scrollerHeight] = useScrollerHeight();
  const model = useLandingModel();
  const {
    flight,
    flightReading,
    landing,
    solution,
    landed,
    noLandingVector,
    board,
    clocks,
    live,
    mayInstruct,
    bodyName,
    atmospheric,
    heightFromTerrain,
    usingComDatum,
    aglReading,
  } = model;

  const width = w ?? 8;
  // Instruments and the altitude rail come in together at a comfortable width; below it, plain readouts.
  const showScope = width >= 6;
  // Below this width a plot is narrower than legible; each plot still decides for itself whether it exists.
  const showPlots = width >= 8;
  // The altitude rail is a gauge, so it is chrome rather than a contributed plot.
  const showRail = showScope;
  // An atmospheric site is described under the same altitude gate its terrain plots draw under; on a vacuum board a sample is enough.
  const atmosphericPlotsShown =
    atmospheric &&
    landing?.sampleSource != null &&
    heightFromTerrain?.lessThan(ATMOSPHERIC_SITE_GATE_M) === true;
  // Whether the site text beside the plots (verdict banner, biome and terrain line) has a site to describe.
  const siteReadoutsShown =
    showPlots &&
    landing?.sampleSource != null &&
    (!atmospheric || atmosphericPlotsShown);
  // The velocity vector is meaningful only for a solved descent at width; once landed the scope stays as a touchdown view.
  const scopeShown =
    (board === "vacuum-solved" || landed || atmosphericPlotsShown) && showScope;

  // Contributed plots: each decides for itself whether it has anything to say, and the board lays out what comes back.
  const contributedPlots = <PlotBoard />;

  const comDatumNote = <ComDatumNote model={model} />;
  const readoutsStack = (
    <SolutionReadouts model={model} showTrend={scopeShown} />
  );
  const boardEl = <DescentBoard model={model} />;
  const velocityEl = <VelocitySection model={model} />;

  // ASL on any frame a payload has arrived; its interval appears once the link stops being current.
  const carriedAltitudeEl = flight ? (
    <CarriedAltitude reading={flightReading} />
  ) : null;

  const heightEl = showRail ? null : <HeightSection model={model} />;
  const divertEl = <DivertSection model={model} />;

  const commitLayerEl = (
    <CommitLayer
      regime={clocks.regime}
      live={live}
      mayInstruct={mayInstruct}
      centreOfMass={usingComDatum}
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

  const verdictBannerEl = siteReadoutsShown ? (
    <VerdictBanner model={model} />
  ) : null;
  const terrainReadoutEl = siteReadoutsShown ? (
    <TerrainReadout model={model} />
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
              <Text level="muted">
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
              <Badge tone={REGIME_TONE[clocks.regime]}>
                {REGIME_LABEL[clocks.regime]}
              </Badge>
            </span>
          </div>
        </Section>,
        bodyName !== undefined ? (
          <Section key="context" full>
            <Text level="muted" size="xs">
              {`${bodyName}${atmospheric ? " · atmospheric" : " · vacuum"}`}
            </Text>
          </Section>
        ) : null,
        /* Not a filling section: the readouts scroll with the panel body, and a section held to the leftover height would overflow past the body's bottom inset. */
        <Section key="descent" full>
          {board === "not-descending" && !landed ? (
            <EmptyState>No landing in progress</EmptyState>
          ) : (
            // Rail and content sit inside the panel's own body, which owns the single inset.
            <div
              ref={measureScroller}
              style={{
                display: "flex",
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
                    centreOfMass={usingComDatum}
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
  minSize: { w: 3, h: 3 },
  component: LandingStatusComponent,
  tiny: {
    title: "LANDING",
    bodyMinSize: { w: 4, h: 6 },
    useEssentials: useLandingEssentials,
  },
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
