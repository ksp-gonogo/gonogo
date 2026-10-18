import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useHeldOpen } from "@ksp-gonogo/core";
import { datedFrom, delayVisibility, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  ContainerBreak,
  Countdown,
  type ElementSize,
  NULL_DISPLAY,
  Panel,
  ScrollArea,
  Section,
  Stack,
  Text,
  useElementSize,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode, RefObject } from "react";
import {
  fittedBoardSize,
  PlotBoard,
  type PlotSlot,
  plotRowWidth,
  usePlotSlots,
} from "../Plots/PlotBoard";
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
// The widget's own plots, registered into `plots` like any Uplink's; imported here so no module ordering can drop them. They draw in this order, the descent profile last: it is the one that leaves at touchdown, and a plot leaving from the end of the row moves none of the others.
import "./crossSectionPlot";
import "./vesselViewPlot";
import "./touchdownReticlePlot";
import "./descentLayers";
import { useLandingEssentials } from "./useLandingEssentials";

export type { FlightReading } from "./CarriedAltitude";

type LandingStatusConfig = Record<string, never>;

/** The smallest a plot is drawn: below it the touchdown site's heading and compass labels run into each other. */
const MIN_LEGIBLE_PLOT_PX = 200;

/** How much wider than tall the visible window is before the header sits beside the plots rather than above them: a tile this short spends its height on the plots. */
const BESIDE_HEADER_ASPECT = 2.5;

/** The widest the header column grows beside the plots: it takes its content's width up to this, and the plots give up the width the rest of the row needs. */
const HEADER_BESIDE_MAX_PX = 220;

/** The narrowest the readouts column may be beside the plots, for the same reason. */
const READOUTS_MIN_PX = 200;

/**
 * The grid the widget lays out in: the header, the plots under it, then the
 * readouts, with the altitude rail down the side and any height left over
 * below the readouts, or the readouts beside plots `besideReadoutsPx` wide. In
 * a short, wide window the header, the plots and the readouts sit side by
 * side, the plots one row as tall as the window.
 */
function landingLayout(
  rail: boolean,
  plotCount: number,
  besideReadoutsPx?: number,
): {
  narrow: CSSProperties;
  wide: CSSProperties;
} {
  const lead = rail ? "rail " : "";
  return {
    narrow:
      besideReadoutsPx === undefined
        ? {
            display: "grid",
            gridTemplateColumns: rail
              ? "auto minmax(0, 1fr)"
              : "minmax(0, 1fr)",
            gridTemplateAreas: ["header", "plots", "readouts"]
              .map((area) => `"${lead}${area}"`)
              .join(" "),
            gridTemplateRows: "auto auto auto",
            // The rows sit at the top and any spare height stays under them, so the rail spanning every row stretches none of the others and no empty row adds a gap past the window's edge.
            alignContent: "start",
            minHeight: "100cqh",
            gap: "var(--gap-section)",
          }
        : {
            display: "grid",
            gridTemplateColumns: `${rail ? "auto " : ""}${besideReadoutsPx}px minmax(0, 1fr)`,
            gridTemplateAreas: ["header header", "plots readouts"]
              .map((areas) => `"${lead}${areas}"`)
              .join(" "),
            gridTemplateRows: "auto auto",
            alignContent: "start",
            minHeight: "100cqh",
            gap: "var(--gap-section)",
          },
    wide: {
      // The plots take up to one row as tall as the window and no more than the width the header and the readouts leave them.
      gridTemplateColumns: `${rail ? "auto " : ""}fit-content(${HEADER_BESIDE_MAX_PX}px) minmax(0, ${plotRowWidth(plotCount)}) minmax(${READOUTS_MIN_PX}px, 1fr)`,
      gridTemplateAreas: `"${lead}header plots readouts"`,
      gridTemplateRows: "100cqh",
    },
  };
}

/** The window height below which a stacked header sets its rows side by side, so a short tile spends its height on the plots. */
const COMPACT_HEADER_BELOW_PX = 280;

type Measured = { ref: RefObject<HTMLDivElement>; size: ElementSize };

/**
 * Where the plots go in a window that stacks them under the header: the
 * height they have, so a regular tile shows them whole before the readouts,
 * and the width they take when that leaves the readouts room beside them. None
 * in a wide window, where the plots sit beside the header, or before the window
 * has been measured.
 */
function stackedPlots(
  windowBox: Measured,
  header: ElementSize,
  count: number,
  keepHeadings: boolean,
): { room: number; besideReadoutsPx?: number } | undefined {
  const { w, h } = windowBox.size;
  const layout = windowBox.ref.current?.firstElementChild;
  if (w === 0 || header.h === 0 || !layout) return undefined;
  if (w / h >= BESIDE_HEADER_ASPECT) return undefined;
  const style = getComputedStyle(layout);
  const gap = Number.parseFloat(style.rowGap) || 0;
  const inset =
    Number.parseFloat(style.getPropertyValue("--inset-contributed-plots")) || 0;
  const room = h - header.h - gap - 2 * inset;
  const board = fittedBoardSize(count, header.w, room, keepHeadings);
  return header.w - board.width - gap >= READOUTS_MIN_PX
    ? { room, besideReadoutsPx: board.width }
    : { room };
}

function LandingStatusComponent({
  w,
}: Readonly<ComponentProps<LandingStatusConfig>>) {
  const model = useLandingModel();
  const windowBox = useElementSize({ w: 0, h: 0 });
  const headerBox = useElementSize({ w: 0, h: 0 });
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
    // Only an atmosphere has a descent profile to wait for.
    ...(atmospheric
      ? [{ subject: "descent-profile", title: "Descent profile", note: idle }]
      : []),
  ];

  const plotSlots = usePlotSlots(reservedPlots);
  const stacked = stackedPlots(
    windowBox,
    headerBox.size,
    plotSlots.length,
    plotSlots.some((slot) => slot.plot?.held !== undefined),
  );
  const compactHeader =
    windowBox.size.h > 0 &&
    windowBox.size.w / windowBox.size.h < BESIDE_HEADER_ASPECT &&
    windowBox.size.h < COMPACT_HEADER_BELOW_PX;
  // Contributed plots: each decides for itself whether it has anything to say, and the board lays out what comes back.
  const contributedPlots = (
    // gonogo:reads none
    <PlotBoard
      reserve={reservedPlots}
      minPlotPx={MIN_LEGIBLE_PLOT_PX}
      fitHeight={stacked?.room}
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
      inline={compactHeader}
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

  const railShown = showRail && showBoard;
  // A crash ends the descent and takes the vessel's readings with it: the touchdown plots stay, holding what they last drew.
  const plotsShown = showBoard || (crash !== undefined && showPlots);
  const readoutEls = (
    <>
      {verdictBannerEl}
      {terrainReadoutEl}
      {boardEl}
      {velocityEl}
      {readoutsStack}
      {carriedAltitudeEl}
      {comDatumNote}
      {heightEl}
      {divertEl}
    </>
  );
  const layout = landingLayout(
    railShown,
    plotSlots.length,
    showPlots ? stacked?.besideReadoutsPx : undefined,
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
      sections={
        <Section
          key="landing"
          fill
          // Out over the body's bottom inset, so this scroller's glow ends on the panel's edge like the body's own.
          style={{ marginBottom: "calc(-1 * var(--panel-body-bottom))" }}
        >
          <ScrollArea>
            {/* The visible window: sized in both axes, so the layout reads its height in container units, and positioned, so nothing absolutely placed inside escapes the scroller. Its bottom padding keeps the inset the body would have given the content. */}
            <div
              ref={windowBox.ref}
              style={{
                containerType: "size",
                height: "100%",
                position: "relative",
                paddingBottom: "var(--panel-body-bottom)",
              }}
            >
              <ContainerBreak
                atAspect={BESIDE_HEADER_ASPECT}
                narrow={layout.narrow}
                wide={layout.wide}
              >
                {railShown && (
                  // Sticky and as tall as the visible window, so the whole scale and its cue stay in view while the readouts scroll.
                  <div
                    style={{
                      gridArea: "rail",
                      position: "sticky",
                      top: 0,
                      alignSelf: "start",
                      height: "100cqh",
                      // An instrument dimension: the width the scale's labels and track need.
                      width: 64,
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
                      live={clocks.regime === "live"}
                    />
                  </div>
                )}
                {/* The link state first: a delayed descent is flown by these countdowns, so a narrow tile must not fold them away. Through a descent every row is always present, so no state can change the height above the plots. */}
                <div
                  ref={headerBox.ref}
                  style={{ gridArea: "header", minWidth: 0 }}
                >
                  <HeaderRows compact={compactHeader}>
                    <HeaderRows compact={compactHeader} inner>
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
                    </HeaderRows>
                    {bodyName !== undefined &&
                      !recordOnly &&
                      (crashInContext ? (
                        <CrashLine crash={crash} context={bodyLine} />
                      ) : (
                        <Text level="muted" size="xs">
                          {bodyLine}
                        </Text>
                      ))}
                  </HeaderRows>
                </div>
                {plotsShown && (
                  // Beside the header the plots are one row as tall as the window, and the readouts take the rest of the width.
                  <ContainerBreak
                    atAspect={BESIDE_HEADER_ASPECT}
                    narrow={{
                      gridArea: "plots",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      // No FramedDisplay: a contributed plot's chart owns its frame.
                      padding: showPlots
                        ? "var(--inset-contributed-plots)"
                        : undefined,
                    }}
                    wide={
                      {
                        padding: 0,
                        "--grid-squares-height": "100cqh",
                      } as CSSProperties
                    }
                  >
                    {contributedPlots}
                  </ContainerBreak>
                )}
                {showBoard && (
                  // Beside the plots the readouts scroll on their own, so the window never scrolls the plots out of view.
                  <ContainerBreak
                    atAspect={BESIDE_HEADER_ASPECT}
                    narrow={
                      {
                        gridArea: "readouts",
                        minWidth: 0,
                        "--bleed-inline": "0px",
                      } as CSSProperties
                    }
                    wide={{
                      display: "flex",
                      flexDirection: "column",
                      // Down over the window's bottom inset, so this scroller's glow ends on the panel's edge.
                      height: "calc(100cqh + var(--panel-body-bottom))",
                    }}
                  >
                    <ScrollArea>
                      {/* Positioned, so nothing absolutely placed in the readouts escapes this scroller. */}
                      <div style={{ position: "relative" }}>
                        {showPlots ? (
                          <ContainerBreak
                            atAspect={BESIDE_HEADER_ASPECT}
                            narrow={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "var(--gap-section)",
                            }}
                            // The window's bottom inset, which this scroller reaches down over.
                            wide={{ paddingBottom: "var(--panel-body-bottom)" }}
                          >
                            {readoutEls}
                          </ContainerBreak>
                        ) : (
                          <Stack>{readoutEls}</Stack>
                        )}
                      </div>
                    </ScrollArea>
                  </ContainerBreak>
                )}
              </ContainerBreak>
            </div>
          </ScrollArea>
        </Section>
      }
    />
  );
}

/**
 * The header's rows: stacked, or in a short tile side by side and wrapping,
 * so the header gives its height to the plots.
 */
function HeaderRows({
  compact,
  inner = false,
  children,
}: {
  compact: boolean;
  inner?: boolean;
  children: ReactNode;
}) {
  // One wrapping row for every item, so a short line joins the one before it.
  if (compact)
    return inner ? (
      children
    ) : (
      <Cluster justify="start" align="baseline" gap="related" wrap>
        {children}
      </Cluster>
    );
  return inner ? (
    <Stack>{children}</Stack>
  ) : (
    <Stack gap="section-compact">{children}</Stack>
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
  // Declaring the slot is the whole opt-in; the widget's own descent profile arrives through it too.
  contributionSlots: ["plots"],
  pushable: true,
  requires: ["flight"],
  // The crash that ended a flight is a record the widget keeps showing after the game leaves the flight scene.
  heldOpenBy: ["crash-ending"],
});

export { LandingStatusComponent };
