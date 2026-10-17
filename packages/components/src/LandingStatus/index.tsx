import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useHeldOpen } from "@ksp-gonogo/core";
import { datedFrom, delayVisibility, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import { PlotBoard, type PlotSlot } from "../Plots/PlotBoard";
import { AltitudeRail } from "./AltitudeRail";
import {
  CarriedAltitude,
  predictionOnRail,
  seaLevelOnRail,
} from "./CarriedAltitude";
import { CommitLayer, REGIME_LABEL, REGIME_TONE } from "./CommitLayer";
import { CrashLine, CrashOutcome } from "./CrashOutcome";
import { DescentBoard } from "./DescentBoard";
import {
  ComDatumNote,
  DivertSection,
  HeightSection,
  VelocitySection,
} from "./DescentSections";
import read from "./landing-status.declarations.g";
import {
  TerrainReadout,
  TerrainReadoutIdle,
  VerdictBanner,
  VerdictBannerIdle,
} from "./SiteReadouts";
import { SolutionReadouts } from "./SolutionReadouts";
import { ATMOSPHERIC_SITE_GATE_M } from "./siteGate";
import { useLandingModel } from "./useLandingModel";
import { useScrollerHeight } from "./useScrollerHeight";
// The widget's own plots, registered into `plots` like any Uplink's; imported here so no module ordering can drop them. They draw in this order, the descent envelope last: it is the one that leaves at touchdown, and a plot leaving from the end of the row moves none of the others.
import "./crossSectionPlot";
import "./vesselViewPlot";
import "./touchdownReticlePlot";
import "./descentLayers";
import { useLandingEssentials } from "./useLandingEssentials";

export type { FlightReading } from "./CarriedAltitude";

type LandingStatusConfig = Record<string, never>;

/** The smallest a plot is drawn: below it the touchdown site's heading and compass labels run into each other. */
const MIN_LEGIBLE_PLOT_PX = 220;

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
    crash,
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

  // The crash that ended the flight, shown after the game has left the flight scene: a record of the last flight, with nothing live beside it.
  const heldOpen = useHeldOpen();
  const recordOnly = crash !== undefined && heldOpen === "crash-ending";
  // Whether the craft is on its way down to the ground, which the burn figures rest on.
  const descending = !recordOnly && !(board === "not-descending" && !landed);
  // The board stands up front whenever a vessel is reporting: the widget exists to make a landing prediction, so it is there before one exists and says what it lacks. Only a flight with nothing reporting gives way to the notice.
  const showBoard = !recordOnly && (descending || flight !== undefined);
  // With delay switched off there is no round trip to state; out of contact the row stays, with a dash.
  const roundTripShown =
    clocks.roundTripSeconds == null ||
    delayVisibility(clocks.roundTripSeconds / 2) === "shown";

  // Each plot keeps its place through the whole descent: before its data arrives, and after it has no more to say, its frame stays and says so.
  // With the board up the descent already keeps a row for the body, so the crash takes that row's place and nothing above the plots grows.
  const crashInContext =
    crash !== undefined && showBoard && bodyName !== undefined;
  const bodyLine = `${bodyName} · ${atmospheric ? "atmospheric" : "vacuum"}`;
  const idle = crash
    ? "Crashed"
    : landed
      ? "Landed"
      : descending
        ? "Awaiting data"
        : "Awaiting a landing prediction";
  const reservedPlots: PlotSlot[] = [
    // The view and the map that projects it sit side by side, so a point is matched across a gutter and not a row.
    { subject: "vessel-view", title: "Touchdown view", note: idle },
    { subject: "touchdown-site", title: "Touchdown site", note: idle },
    { subject: "landing-cross-section", title: "Cross-section", note: idle },
    // Only an atmosphere has a descent envelope to wait for.
    ...(atmospheric
      ? [{ subject: "descent-envelope", title: "Descent envelope", note: idle }]
      : []),
  ];

  // Contributed plots: each decides for itself whether it has anything to say, and the board lays out what comes back.
  const contributedPlots = (
    // gonogo:reads none
    <PlotBoard reserve={reservedPlots} minPlotPx={MIN_LEGIBLE_PLOT_PX} />
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
      descending={descending}
      predicted={landing !== undefined}
      crashed={crash !== undefined}
      noLandingVector={noLandingVector}
      impactSpeed={solution.bestSpeedAtImpact}
      burning={model.burning}
      engine={model.engine}
      parachute={{
        deployment: landing?.parachuteDeployment ?? null,
        safety: landing?.parachuteDeploySafety ?? null,
        fullDeployAltitude: landing?.parachuteFullDeployAltitude ?? null,
      }}
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

  // Both rows are in the layout whenever the plots are, empty until there is a site, so a site arriving moves nothing below them.
  const verdictBannerEl = !showPlots ? null : siteReadoutsShown ? (
    <VerdictBanner model={model} />
  ) : (
    <VerdictBannerIdle />
  );
  const terrainReadoutEl = !showPlots ? null : siteReadoutsShown ? (
    <TerrainReadout model={model} />
  ) : (
    <TerrainReadoutIdle />
  );

  return (
    <Panel
      panelTitle="LANDING"
      // The link regime is the widget's state, so it sits in the header with the other state badges rather than in the body, where its width would move the rows.
      // A live link is the ordinary state and says nothing; only a staged, autonomous or missing one does.
      panelBadges={
        clocks.regime === "live"
          ? []
          : [
              {
                id: "landing-regime",
                label: REGIME_LABEL[clocks.regime],
                tone: REGIME_TONE[clocks.regime],
                title:
                  "How the vessel's link to the ground is carrying this descent",
              },
            ]
      }
      // No vessel reporting and no crash on record: the panel has nothing to present, so it gives its body over to the reason.
      inactive={!showBoard && !crash ? "No landing in progress" : undefined}
      // Host-derived: the panel watches every topic this widget declares.
      sections={[
        // The link state, first and full width: a delayed descent is flown by these countdowns, so a narrow tile must not fold them away.
        // Through a descent every row is always present, so no state can change the height above the plots; with nothing descending there is no round trip to time, and the empty state keeps the room.
        <Section key="link" full>
          <Stack>
            {commitLayerEl}
            {crash && !crashInContext && (
              <CrashOutcome crash={crash} record={recordOnly} />
            )}
            {showBoard && roundTripShown && (
              <Text level="muted">
                RT{" "}
                {clocks.roundTripSeconds != null ? (
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
            )}
          </Stack>
        </Section>,
        bodyName !== undefined && !recordOnly ? (
          <Section key="context" full>
            {crashInContext ? (
              <CrashLine crash={crash} context={bodyLine} />
            ) : (
              <Text level="muted" size="xs">
                {bodyLine}
              </Text>
            )}
          </Section>
        ) : null,
        /* Not a filling section: the readouts scroll with the panel body, and a section held to the leftover height would overflow past the body's bottom inset. */
        <Section key="descent" full>
          {!showBoard ? (
            <Stack>
              {/* A crash ends the descent and takes the vessel's readings with it: the touchdown plots stay, holding what they last drew. */}
              {crash && showPlots && (
                <div style={{ padding: "var(--inset-contributed-plots)" }}>
                  {contributedPlots}
                </div>
              )}
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
                    ignitionAltitude={
                      landed || !model.mayInstruct
                        ? null
                        : solution.ignitionAltitude
                    }
                    suicideBurnCountdown={
                      landed || !model.mayInstruct
                        ? null
                        : solution.suicideBurnCountdown
                    }
                    instructionWithheld={!model.mayInstruct}
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
    "Everything for a powered landing: altitude, time to impact, the suicide burn (the latest burn that still stops you before the ground) with the Δv and fuel it needs, a top-down view of where you will touch down and a side view of the terrain on the way. Under signal delay it shows what was last seen beside what is predicted now.",
  tags: ["telemetry", "landing"],
  // Wide enough for the plots to sit side by side, and tall enough for every row of the worst state (a crash) to be in view without scrolling.
  defaultSize: { w: 14, h: 24 },
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
  // The crash that ended a flight is a record the widget keeps showing after the game leaves the flight scene.
  heldOpenBy: ["crash-ending"],
});

export { LandingStatusComponent };
