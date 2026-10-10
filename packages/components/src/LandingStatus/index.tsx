import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  EmptyState,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
  Text,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { PlotBoard } from "../Plots/PlotBoard";
import { AltitudeRail } from "./AltitudeRail";
import {
  CarriedAltitude,
  predictionOnRail,
  seaLevelOnRail,
} from "./CarriedAltitude";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { DescentBoard } from "./DescentBoard";
import {
  ComDatumNote,
  DivertSection,
  HeightSection,
  VelocitySection,
} from "./DescentSections";
import read from "./landing-status.declarations.g";
import { TerrainReadout, VerdictBanner } from "./SiteReadouts";
import { SolutionReadouts } from "./SolutionReadouts";
import { ATMOSPHERIC_SITE_GATE_M } from "./siteGate";
import { useLandingModel } from "./useLandingModel";
import { useScrollerHeight } from "./useScrollerHeight";
// The widget's own plots, registered into `plots` like any Uplink's; imported here so no module ordering can drop them. They draw in this order, the descent envelope last: it is the one that leaves at touchdown, and a plot leaving from the end of the row moves none of the others.
import "./crossSectionPlot";
import "./touchdownReticlePlot";
import "./descentLayers";
import { useLandingEssentials } from "./useLandingEssentials";

export type { FlightReading } from "./CarriedAltitude";

type LandingStatusConfig = Record<string, never>;

/** The share of the room below the link rows the plots may take, so in a short tile they shrink and the readouts under them stay in reach. */
const PLOTS_SHARE_OF_ROOM = 0.6;

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const [measureScroller, railFrame] = useScrollerHeight();
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
  const contributedPlots = (
    // gonogo:reads none
    <PlotBoard
      heightPx={
        railFrame.room > 0 ? railFrame.room * PLOTS_SHARE_OF_ROOM : undefined
      }
    />
  );

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
      burning={model.burning}
      engine={model.engine}
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
      <WidgetSections />
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
      // The link regime is the widget's state, so it sits in the header with the other state badges rather than in the body, where its width would move the rows.
      panelBadges={[
        {
          id: "landing-regime",
          label: REGIME_LABEL[clocks.regime],
          tone: REGIME_TONE[clocks.regime],
          title: "How the vessel's link to the ground is carrying this descent",
        },
      ]}
      // Planted sections go beside the altitude rail, in the readouts column, never under it.
      panelSections={false}
      // Host-derived: the panel watches every topic this widget declares.
      sections={[
        // The link state, first and full width: a delayed descent is flown by these countdowns, so a narrow tile must not fold them away.
        // Every row is always present and none wraps, so no state can change the height above the plots.
        <Section key="link" full>
          <Stack>
            {commitLayerEl}
            <Text level="muted">
              RT{" "}
              {clocks.roundTripSeconds != null &&
              clocks.roundTripSeconds > 0 ? (
                <Countdown
                  value={datedFrom(
                    model.delayCurrency,
                    value("s", clocks.roundTripSeconds),
                  )}
                  precise
                />
              ) : (
                NULL_DISPLAY
              )}
            </Text>
          </Stack>
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
            <Stack>
              <EmptyState>No landing in progress</EmptyState>
              <WidgetSections />
            </Stack>
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
                    top: railFrame.top,
                    alignSelf: "flex-start",
                    // The visible height below the rail's top edge, so the whole scale and its cue are in view.
                    height: railFrame.height > 0 ? railFrame.height : undefined,
                  }}
                >
                  <AltitudeRail
                    agl={aglReading}
                    prediction={predictionOnRail(flightReading, aglReading)}
                    seaLevel={seaLevelOnRail(flightReading, aglReading)}
                    verticalSpeed={solution.verticalSpeed}
                    centreOfMass={usingComDatum}
                    ignitionAltitude={landed ? null : solution.ignitionAltitude}
                    suicideBurnCountdown={
                      landed ? null : solution.suicideBurnCountdown
                    }
                    burning={model.burning}
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
                      <WidgetSections />
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
    "Everything for a powered landing: altitude, time to impact, the suicide burn with the Δv and fuel it needs, a top-down view of where you will touch down and a side view of the terrain on the way. Under signal delay it shows what was last seen beside what is predicted now.",
  tags: ["telemetry", "landing"],
  // Wide enough for both plots to sit side by side, with the verdict under them, in view without scrolling.
  defaultSize: { w: 14, h: 15 },
  minSize: { w: 4, h: 6 },
  component: LandingStatusComponent,
  tiny: {
    title: "LANDING",
    useEssentials: useLandingEssentials,
  },
  channels: ["vessel.flight", "vessel.landing"],
  ...read,
  defaultConfig: {},
  augmentSlots: ["landing-status.sections", "landing-status.actions"],
  // Declaring the slot is the whole opt-in; the widget's own descent envelope arrives through it too.
  contributionSlots: ["plots"],
  pushable: true,
  requires: ["flight"],
});

export { LandingStatusComponent };
