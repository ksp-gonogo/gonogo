import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { plotColumnsOf } from "@ksp-gonogo/data";
import { DELTA_V_BUDGET, useProcessor } from "@ksp-gonogo/sitrep-client";
import {
  combineReadings,
  type Reading,
  stillTrue,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Dial,
  EmptyState,
  FramedDisplay,
  Panel,
  Section,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { budgetFigure } from "../FuelStatus/deltaV";
import { magnitudeOf } from "../shared/magnitude";
import { useComputedSeries } from "../shared/useComputedSeries";
import {
  GAUGE_MAX,
  GAUGE_MIN,
  TINY_BANDS,
  tinyToneFor,
  toneColorFor,
  twrOf,
  ZONES,
} from "./scale";
import read from "./twr.declarations.g";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

/** The stage whose ratio is drawn when nothing is firing, and the ratio at its ignition. */
interface NextStageTwr {
  stage: number;
  twr: number;
}

/**
 * Thrust over weight: the wire carries thrust and mass, not their ratio. While
 * the craft is making no thrust the active stage's ratio is a known zero, so the
 * figure is the next stage that has thrust, from the stage list, and `stage`
 * names which one it is.
 */
function useTwrReading(): { reading: Reading<Value<"1">>; stage?: number } {
  const propulsionReading = useTelemetry("vessel.propulsion");
  const structureReading = useTelemetry("vessel.structure");
  const currentStage = stillTrue(structureReading, undefined)?.currentStage;
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const stages =
    budgetReading?.state === "observed" || budgetReading?.state === "held"
      ? budgetReading.value?.stages
      : undefined;
  const live = combineReadings(
    [propulsionReading.currentThrust, propulsionReading.totalMass],
    (currentThrust, totalMass) => {
      const thrust = magnitudeOf(currentThrust);
      const mass = magnitudeOf(totalMass);
      const ratio =
        thrust === null || mass === null ? null : twrOf(thrust, mass);
      return ratio === null || !Number.isFinite(ratio)
        ? undefined
        : value("1", ratio);
    },
  );
  const idle = live.value?.isZero() === true;
  const next = idle ? nextStageWithThrust(stages, currentStage) : undefined;
  if (next === undefined || budgetReading === undefined) {
    return { reading: live };
  }
  return {
    reading: budgetFigure(budgetReading, value("1", next.twr)),
    stage: next.stage,
  };
}

/** The highest stage at or below the current one that makes thrust: the one the next ignition lights. */
function nextStageWithThrust(
  stages:
    | ReadonlyArray<{ stage: number; thrustActual: number; TWRActual: number }>
    | undefined,
  currentStage: number | undefined,
): NextStageTwr | undefined {
  let best: NextStageTwr | undefined;
  for (const s of stages ?? []) {
    if (currentStage !== undefined && s.stage > currentStage) continue;
    if (!Number.isFinite(s.thrustActual) || s.thrustActual <= 0) continue;
    if (!Number.isFinite(s.TWRActual)) continue;
    if (best === undefined || s.stage > best.stage) {
      best = { stage: s.stage, twr: s.TWRActual };
    }
  }
  return best;
}

/** The ratio on a dial's own scale, which the tiny form draws as a figure over a gauge. */
function useTwrEssentials(): readonly TinyEssential[] {
  const { reading: twrReading, stage } = useTwrReading();
  const twr = twrReading.value;
  return [
    {
      label: stage === undefined ? "TWR" : `TWR S${stage}`,
      value: twrReading,
      gauge: { min: GAUGE_MIN, max: GAUGE_MAX, bands: TINY_BANDS },
      tone: twr === undefined ? "neutral" : tinyToneFor(twr),
    },
  ];
}

function TwrComponent({ w }: Readonly<ComponentProps<TwrConfig>>) {
  const { reading: twrReading, stage } = useTwrReading();
  // A held TWR stays drawn, never blanked: the empty state means the craft has no engine.
  const twr = twrReading.value;
  const series = useComputedSeries(
    { topic: "vessel.propulsion", field: "currentThrust" },
    { topic: "vessel.propulsion", field: "totalMass" },
    SPARK_WINDOW_SEC,
    twrOf,
  );
  const sparkValues = useMemo(() => plotColumnsOf(series).v, [series]);

  // Only the drawings inside the frame are measured, and the frame's size never depends on them.
  const cols = w ?? 4;
  // Below five columns the caption would sit on the gauge arc.
  const showCaption = cols >= 5;

  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 200, h: 110 });
  // The dial draws the largest arc that fits what it is given, and at a height too short for any arc it draws the figure alone.
  const gaugeW = Math.min(gaugeSize.w, GAUGE_MAX_W);
  const gaugeH = Math.min(
    gaugeSize.h - (showCaption ? CAPTION_CLEARANCE : 0),
    Math.round(gaugeW / 2) + GAUGE_FIGURE_H,
  );

  const { ref: sparkRef, size: sparkSize } = useElementSize({ w: 120, h: 40 });

  if (twr === undefined) {
    return (
      <Panel
        panelTitle="TWR"
        sections={
          <Section full>
            <EmptyState>No engine data</EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="TWR"
      panelBadges={
        stage === undefined
          ? undefined
          : [
              {
                id: "stage",
                label: `S${stage}`,
                tone: "neutral",
                title: `Stage ${stage}: the next stage with thrust, drawn while nothing is firing`,
              },
            ]
      }
      sections={
        <Section fill>
          <FramedDisplay
            padded
            style={FRAME_STYLE}
            caption={
              showCaption
                ? `Current stage · last ${writeQuantity(value("s", SPARK_WINDOW_SEC))}`
                : undefined
            }
            strip={
              <div ref={sparkRef} style={SPARK_SLOT_STYLE}>
                <div style={SPARK_PLOT_STYLE}>
                  <Sparkline
                    values={sparkValues}
                    width={sparkSize.w + SPARK_OVERDRAW_PX}
                    height={sparkSize.h + SPARK_OVERDRAW_PX}
                    color={toneColorFor(twr)}
                    aria-label="TWR trend"
                  />
                </div>
              </div>
            }
          >
            <div
              ref={gaugeRef}
              style={showCaption ? GAUGE_SLOT_UNDER_CAPTION : GAUGE_SLOT_STYLE}
            >
              <Dial
                startAngle={-90}
                sweep={180}
                value={twrReading}
                min={GAUGE_MIN}
                max={GAUGE_MAX}
                zones={ZONES}
                width={gaugeW}
                height={gaugeH}
                readout="large"
                aria-label={`TWR ${writeQuantity(twr)}`}
              />
            </div>
          </FramedDisplay>
        </Section>
      }
    />
  );
}

const FRAME_STYLE = { flex: 1, minHeight: 0, minWidth: 0 } as const;

const GAUGE_MAX_W = 280;

/** What the dial needs under its arc's base line: half the track, then the drop to its large figure. */
const GAUGE_FIGURE_H = 36;

/** The height the frame's caption covers at its top edge, kept clear of the arc. */
const CAPTION_CLEARANCE = 28;

/** The measured size is floored, so the plot is drawn a pixel over and the strip clips it: the line reaches the frame's inner edge instead of stopping a fraction short. */
const SPARK_OVERDRAW_PX = 1;

/** The dial centres in the room the strip leaves, and anything it cannot fit is clipped here, short of the frame's border. */
const GAUGE_SLOT_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
} as const;

const GAUGE_SLOT_UNDER_CAPTION = {
  ...GAUGE_SLOT_STYLE,
  alignItems: "flex-end",
} as const;

const SPARK_SLOT_STYLE = {
  position: "relative",
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
} as const;

/** Out of flow, so the plot's pixel of overdraw can never grow the strip it is measured from. */
const SPARK_PLOT_STYLE = { position: "absolute", inset: 0 } as const;

registerComponent<TwrConfig>({
  id: "twr",
  name: "TWR",
  description:
    "The vessel's thrust-to-weight ratio right now: its current thrust over its weight at standard gravity (9.81 m/s²), whatever body you are at, not the local gravity. It is a dial running 0 to 3 that pins at 3, with a small line chart (a sparkline) of the last minute. The dial is red below 1, where thrust is less than the vessel's weight at standard gravity, amber from 1 to 1.5, and green above.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  // Below four columns or four rows the dial and its trend stop fitting, and the tile draws the ratio as a figure over a gauge.
  minSize: { w: 4, h: 4 },
  component: TwrComponent,
  tiny: { title: "TWR", useEssentials: useTwrEssentials },
  channels: ["vessel.propulsion"],
  fields: ["vessel.propulsion.currentThrust", "vessel.propulsion.totalMass"],
  ...read,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { TwrComponent };
