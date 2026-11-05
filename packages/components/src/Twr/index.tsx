import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { plotColumnsOf } from "@ksp-gonogo/data";
import {
  CELESTIAL_FACTS,
  DELTA_V_BUDGET,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import {
  bodyAtIndex,
  combineReadings,
  type Reading,
  STANDARD_GRAVITY,
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
  NULL_DISPLAY,
  Panel,
  Section,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useMemo } from "react";
import { budgetFigure } from "../FuelStatus/deltaV";
import { magnitudeOf } from "../shared/magnitude";
import { useParentBodyIndex } from "../shared/useBodyName";
import { useComputedSeries } from "../shared/useComputedSeries";
import {
  GAUGE_BANDS,
  GAUGE_MAX,
  GAUGE_MIN,
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
 * The surface gravity of the body the craft is at, in m/s², from the body
 * catalogue entry the craft's parent body index names. `undefined` while either
 * is missing: no other body's gravity stands in for it.
 */
function useSurfaceGravity(): number | undefined {
  const index = useParentBodyIndex();
  const facts = useProcessor(CELESTIAL_FACTS);
  const catalogue =
    facts?.state === "observed" || facts?.state === "held"
      ? facts.value
      : undefined;
  const gee = bodyAtIndex(catalogue, index)?.geeASL;
  return gee != null && Number.isFinite(gee) && gee > 0
    ? gee * STANDARD_GRAVITY
    : undefined;
}

/**
 * Thrust over weight at the surface gravity of the body the craft is at: the
 * wire carries thrust and mass, not their ratio. The thrust is the lesser of
 * what is reported and what the engines can produce now. While the craft is
 * making no thrust the active stage's ratio is a known zero, so the figure is
 * the next stage that has thrust, from the stage list at its ignition mass and
 * on the same gravity basis, and `stage` names which one it is. With no
 * gravity for the body there is no figure, and `gravity` is `undefined`.
 */
function useTwrReading(): {
  reading: Reading<Value<"1">>;
  stage?: number;
  gravity: number | undefined;
  /** Whether the craft reports an engine ratio's worth of thrust and mass, whatever body it is at. */
  engine: boolean;
} {
  const gravity = useSurfaceGravity();
  const propulsionReading = useTelemetry("vessel.propulsion");
  const structureReading = useTelemetry("vessel.structure");
  const currentStage = stillTrue(structureReading, undefined)?.currentStage;
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const stages =
    budgetReading?.state === "observed" || budgetReading?.state === "held"
      ? budgetReading.value?.stages
      : undefined;
  // What the engines could make, where it is reported: a craft whose stream omits it still has its ratio.
  const availableReading = propulsionReading.availableThrust;
  const availableThrust =
    availableReading.state === "observed" || availableReading.state === "held"
      ? availableReading.value
      : undefined;
  const live = combineReadings(
    [propulsionReading.currentThrust, propulsionReading.totalMass],
    (currentThrust, totalMass) => {
      // No engine makes more than it can: a thrust still reported after every engine stopped is not thrust the craft has.
      const capped =
        currentThrust && availableThrust
          ? currentThrust.min(availableThrust)
          : currentThrust;
      const thrust = magnitudeOf(capped);
      const mass = magnitudeOf(totalMass);
      const ratio =
        thrust === null || mass === null ? null : twrOf(thrust, mass, gravity);
      return ratio === null || !Number.isFinite(ratio)
        ? undefined
        : value("1", ratio);
    },
  );
  const engine = combineReadings(
    [propulsionReading.currentThrust, propulsionReading.totalMass],
    (currentThrust, totalMass) =>
      currentThrust && totalMass && !totalMass.isZero()
        ? value("1", 1)
        : undefined,
  ).value;
  const idle = live.value?.isZero() === true;
  const next = idle
    ? nextStageWithThrust(stages, currentStage, gravity)
    : undefined;
  if (next === undefined || budgetReading === undefined) {
    return { reading: live, gravity, engine: engine !== undefined };
  }
  return {
    reading: budgetFigure(budgetReading, value("1", next.twr)),
    stage: next.stage,
    gravity,
    engine: engine !== undefined,
  };
}

/** The highest stage at or below the current one that makes thrust: the one the next ignition lights. */
function nextStageWithThrust(
  stages:
    | ReadonlyArray<{ stage: number; thrustActual: number; startMass: number }>
    | undefined,
  currentStage: number | undefined,
  gravity: number | undefined,
): NextStageTwr | undefined {
  let best: NextStageTwr | undefined;
  for (const s of stages ?? []) {
    if (currentStage !== undefined && s.stage > currentStage) continue;
    if (!Number.isFinite(s.thrustActual) || s.thrustActual <= 0) continue;
    const twr = twrOf(s.thrustActual, s.startMass, gravity);
    if (twr === null || !Number.isFinite(twr)) continue;
    if (best === undefined || s.stage > best.stage) {
      best = { stage: s.stage, twr };
    }
  }
  return best;
}

/** The kit's arc gauge over the same scale as the body's dial, with the next stage's ratio while nothing fires. */
function useTwrEssentials(): readonly TinyEssential[] {
  const { reading, gravity, engine } = useTwrReading();
  // A held TWR stays drawn: only a craft with no engine, or no gravity for its body, has nothing to put on the arc.
  if (reading.value === undefined) {
    return [
      {
        label: "TWR",
        word: engine && gravity === undefined ? NULL_DISPLAY : "No engine",
      },
    ];
  }
  return [
    {
      label: "TWR",
      value: reading,
      gauge: {
        style: "arc",
        min: GAUGE_MIN,
        max: GAUGE_MAX,
        bands: GAUGE_BANDS,
      },
    },
  ];
}

function TwrComponent({ w }: Readonly<ComponentProps<TwrConfig>>) {
  const { reading: twrReading, stage, gravity, engine } = useTwrReading();
  // A held TWR stays drawn, never blanked: the empty state means the craft has no engine.
  const twr = twrReading.value;
  const atGravity = useCallback(
    (thrust: number, mass: number) => twrOf(thrust, mass, gravity),
    [gravity],
  );
  const series = useComputedSeries(
    { topic: "vessel.propulsion", field: "currentThrust" },
    { topic: "vessel.propulsion", field: "totalMass" },
    SPARK_WINDOW_SEC,
    atGravity,
  );
  const sparkValues = useMemo(() => plotColumnsOf(series).v, [series]);
  // The trend is drawn while the craft is thrusting; with the next stage's ratio on show there is no line, and the dial takes the frame.
  const showTrend = stage === undefined && gravity !== undefined;

  // Only the drawings inside the frame are measured, and the frame's size never depends on them.
  const cols = w ?? 4;
  // Below five columns the caption would sit on the gauge arc.
  const showCaption = cols >= 5 && gravity !== undefined;

  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 200, h: 110 });
  // The dial draws the largest arc that fits what it is given, and at a height too short for any arc it draws the figure alone.
  const gaugeW = Math.min(gaugeSize.w, GAUGE_MAX_W);
  const gaugeH = Math.min(
    gaugeSize.h - (showCaption ? CAPTION_CLEARANCE : 0),
    Math.round(gaugeW / 2) + GAUGE_FIGURE_H,
  );

  const { ref: sparkRef, size: sparkSize } = useElementSize({ w: 120, h: 40 });

  // The dial shows a dash for a body whose gravity is missing; only a craft with no engine has nothing to draw.
  if (twr === undefined && (gravity !== undefined || !engine)) {
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
              !showCaption
                ? undefined
                : stage === undefined
                  ? `Current stage · last ${writeQuantity(value("s", SPARK_WINDOW_SEC))}`
                  : `Stage ${stage} at ignition`
            }
            strip={
              showTrend ? (
                <div ref={sparkRef} style={SPARK_SLOT_STYLE}>
                  <div style={SPARK_PLOT_STYLE}>
                    <Sparkline
                      values={sparkValues}
                      width={sparkSize.w + SPARK_OVERDRAW_PX}
                      height={sparkSize.h + SPARK_OVERDRAW_PX}
                      color={
                        twr === undefined
                          ? "var(--color-text-muted)"
                          : toneColorFor(twr)
                      }
                      aria-label="TWR trend"
                    />
                  </div>
                </div>
              ) : undefined
            }
          >
            {showTrend ? (
              <div
                ref={gaugeRef}
                style={
                  showCaption ? GAUGE_SLOT_UNDER_CAPTION : GAUGE_SLOT_STYLE
                }
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
                  aria-label={
                    twr === undefined ? "TWR" : `TWR ${writeQuantity(twr)}`
                  }
                />
              </div>
            ) : (
              <div style={FACE_STYLE}>
                <div ref={gaugeRef} style={GAUGE_LAYER_STYLE}>
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
                    aria-label={
                      twr === undefined ? "TWR" : `TWR ${writeQuantity(twr)}`
                    }
                  />
                </div>
              </div>
            )}
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

/** With no trend drawn the dial takes the frame's whole face and its figure sits at the bottom edge. */
const FACE_STYLE = {
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
} as const;

const GAUGE_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "flex-end",
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
    "The vessel's thrust-to-weight ratio right now: its current thrust over its weight at the surface gravity of the body you are at, so the same craft reads higher on the Mun than at Kerbin. It is a dial running 0 to 3 that pins at 3, with a small line chart (a sparkline) of the last minute. The dial is red below 1, where thrust is less than the vessel's weight at that body, amber from 1 to 1.5, and green above. The dial shows a dash when the body's gravity is not known.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  // Below four columns or four rows the frame, caption and trend strip give way to the kit's tiny arc.
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
