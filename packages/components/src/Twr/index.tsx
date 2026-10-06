import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { plotColumnsOf } from "@ksp-gonogo/data";
import { combineReadings, value } from "@ksp-gonogo/sitrep-sdk";
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
import { magnitudeOf } from "../shared/magnitude";
import { useComputedSeries } from "../shared/useComputedSeries";
import { GAUGE_MAX, GAUGE_MIN, toneColorFor, twrOf, ZONES } from "./scale";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

type Variant = "small" | "normal";

function variantFor(cols: number, rows: number): Variant {
  if (rows < 4 || cols < 4) return "small";
  return "normal";
}

/** Thrust over weight: the wire carries thrust and mass, not their ratio. */
function useTwrReading() {
  const propulsionReading = useTelemetry("vessel.propulsion");
  return combineReadings(
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
}

function TwrComponent({ w, h }: Readonly<ComponentProps<TwrConfig>>) {
  const twrReading = useTwrReading();
  // A held TWR stays drawn, never blanked: the empty state means the craft has no engine.
  const twr = twrReading.value;
  const series = useComputedSeries(
    { topic: "vessel.propulsion", field: "currentThrust" },
    { topic: "vessel.propulsion", field: "totalMass" },
    SPARK_WINDOW_SEC,
    twrOf,
  );
  const sparkValues = useMemo(() => plotColumnsOf(series).v, [series]);

  // The variant follows grid size; only the drawings inside the frame are measured, and the frame's size never depends on them.
  const cols = w ?? 4;
  const rows = h ?? 5;
  const variant = variantFor(cols, rows);
  const showSparkline = variant === "normal";
  // Below five columns the caption would sit on the gauge arc.
  const showCaption = variant === "normal" && cols >= 5;

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
              showSparkline ? (
                <div ref={sparkRef} style={SPARK_SLOT_STYLE}>
                  <div style={SPARK_PLOT_STYLE}>
                    <Sparkline
                      values={sparkValues}
                      width={sparkSize.w + SPARK_OVERDRAW_PX}
                      height={sparkSize.h + SPARK_OVERDRAW_PX}
                      color={toneColorFor(twr)}
                      ariaLabel="TWR trend"
                    />
                  </div>
                </div>
              ) : undefined
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
                ariaLabel={`TWR ${writeQuantity(twr)}`}
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
    "Thrust-to-weight ratio of the active stage as a dial. Red below 1 (can't lift off), amber 1–1.5, green above. Sparkline shows the last minute.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 3 },
  component: TwrComponent,
  dataRequirements: [
    "vessel.propulsion.currentThrust",
    "vessel.propulsion.totalMass",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { TwrComponent };
