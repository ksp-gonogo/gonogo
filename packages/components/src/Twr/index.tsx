import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  combineReadings,
  type TinyEssential,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Gauge, Sparkline } from "@ksp-gonogo/ui";
import {
  EmptyState,
  Panel,
  Section,
  Text,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import { useComputedSeries } from "../shared/useComputedSeries";
import {
  essentialToneFor,
  GAUGE_MAX,
  GAUGE_MIN,
  toneColorFor,
  twrOf,
  ZONES,
} from "./scale";

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

function useTwrEssentials(): readonly TinyEssential[] {
  const twrReading = useTwrReading();
  const twr = twrReading.value;
  return [
    {
      label: "TWR",
      value: twrReading,
      decimals: 1,
      tone: twr === undefined ? "neutral" : essentialToneFor(twr),
    },
  ];
}

function TwrComponent({ w, h }: Readonly<ComponentProps<TwrConfig>>) {
  const twrReading = useTwrReading();
  // A stale TWR is held, never blanked: the empty state means the craft has no engine.
  const twr = twrReading.value;
  const series = useComputedSeries(
    "vessel.propulsion.currentThrust",
    "vessel.propulsion.totalMass",
    SPARK_WINDOW_SEC,
    twrOf,
  );
  const sparkValues = series.v as number[];

  // Layout follows grid size, not measured pixels, so the inner widgets cannot set up a ResizeObserver feedback loop.
  const cols = w ?? 4;
  const rows = h ?? 5;
  const variant = variantFor(cols, rows);
  const showSparkline = variant === "normal";
  // At the 4x5 default the gauge arc overlaps the subtitle row.
  const showSubtitle = variant === "normal" && cols >= 5;

  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 200, h: 110 });

  // Capped by width and by a slice of the widget height so the SVG never overflows its slot.
  const gaugeMaxH = Math.max(64, rows * 25 * 0.4);
  const gaugeW = Math.min(
    gaugeSize.w || 200,
    220,
    Math.round(gaugeMaxH / 0.55),
  );
  const gaugeH = Math.round(gaugeW * 0.55);

  const { ref: sparkRef, size: sparkSize } = useElementSize({ w: 120, h: 24 });
  const sparkWidth = Math.max(40, sparkSize.w);

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

  const toneColor = toneColorFor(twr);

  return (
    <Panel
      panelTitle="TWR"
      fitToSize
      sections={[
        showSubtitle && (
          <Section key="caption" full>
            <Text tone="muted" size="xs">
              Current stage · last {writeQuantity(value("s", SPARK_WINDOW_SEC))}
            </Text>
          </Section>
        ),
        <Section key="gauge" full>
          <div ref={gaugeRef} style={GAUGE_SLOT_STYLE}>
            <Gauge
              value={twrReading}
              min={GAUGE_MIN}
              max={GAUGE_MAX}
              zones={ZONES}
              width={gaugeW}
              height={gaugeH}
              ariaLabel={`TWR ${writeQuantity(twr)}`}
            />
          </div>
        </Section>,
        showSparkline && (
          <Section key="trend" full>
            <div ref={sparkRef} style={SPARK_SLOT_STYLE}>
              <Sparkline
                values={sparkValues}
                width={sparkWidth}
                height={24}
                color={toneColor}
                ariaLabel="TWR trend"
              />
            </div>
          </Section>
        ),
      ]}
    />
  );
}

/** The dial centres in whatever height the sections leave it. */
const GAUGE_SLOT_STYLE = {
  flex: "1 1 auto",
  width: "100%",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

// The margin tops the 12px section gap up to the 20px the Gauge's bottom-edge value label needs, so it is off the spacing ladder.
const SPARK_SLOT_STYLE = {
  width: "100%",
  height: "24px",
  flex: "0 0 auto",
  marginTop: "8px",
} as const;

registerComponent<TwrConfig>({
  id: "twr",
  name: "TWR",
  description:
    "Thrust-to-weight ratio of the active stage as a dial. Red below 1 (can't lift off), amber 1–1.5, green above. Sparkline shows the last minute.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 2, h: 2 },
  component: TwrComponent,
  tiny: {
    title: "TWR",
    // The dial needs three columns and rows; below that the figure stands alone.
    bodyMinSize: { w: 3, h: 3 },
    useEssentials: useTwrEssentials,
  },
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
