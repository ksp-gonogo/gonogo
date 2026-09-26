import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { combineReadings, value } from "@ksp-gonogo/sitrep-sdk";
import { Gauge, Sparkline } from "@ksp-gonogo/ui";
import {
  EmptyState,
  NULL_DISPLAY,
  Panel,
  Section,
  Text,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import { useComputedSeries } from "../shared/useComputedSeries";
import { GAUGE_MAX, GAUGE_MIN, toneColorFor, twrOf, ZONES } from "./scale";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

type Variant = "tiny" | "small" | "normal";

function variantFor(cols: number, rows: number): Variant {
  if (rows < 3 || cols < 3) return "tiny";
  if (rows < 4 || cols < 4) return "small";
  return "normal";
}

function TwrComponent({ w, h }: Readonly<ComponentProps<TwrConfig>>) {
  // The wire carries thrust and mass, not their ratio.
  const propulsionReading = useTelemetry("vessel.propulsion");
  const twrReading = combineReadings(
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
  const twr = twrReading.value;
  // A stale TWR is held, never blanked: the empty state means the craft has no engine.
  const twrNotCurrent = twrReading.state === "stale";
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
            {/* The full sentence clips to "No" at tiny width. */}
            <EmptyState>
              {variant === "tiny" ? NULL_DISPLAY : "No engine data"}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  const toneColor = toneColorFor(twr);

  if (variant === "tiny") {
    return (
      <Panel
        panelTitle="TWR"
        fitToSize
        sections={
          <Section full>
            {/* No room here for the larger layout's word mark, so a held figure is dimmed instead. */}
            <span
              style={{
                ...TINY_VALUE_STYLE,
                color: toneColor,
                ...(twrNotCurrent ? { opacity: 0.55 } : {}),
              }}
            >
              {writeQuantity(twr, { decimals: 1 })}
            </span>
          </Section>
        }
      />
    );
  }

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

// 24px keeps a three-character value inside the tiny panel's ~70px inner width, so it is off the type scale.
const TINY_VALUE_STYLE = {
  fontSize: "24px",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.04em",
  lineHeight: "var(--line-height-flush)",
  whiteSpace: "nowrap",
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
