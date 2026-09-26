import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  combineReadings,
  STANDARD_GRAVITY,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Gauge, type GaugeZone, Sparkline } from "@ksp-gonogo/ui";
import {
  EmptyState,
  NULL_DISPLAY,
  Panel,
  Section,
  Text,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { useComputedSeries } from "../shared/useComputedSeries";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

/**
 * Thrust over weight at standard gravity: kilonewtons over tonnes is newtons
 * over kilograms, so the ratio needs no conversion. `null` without a positive
 * mass.
 */
function twrOf(thrust: number, mass: number): number | null {
  return mass > 0 ? thrust / (mass * STANDARD_GRAVITY) : null;
}

// Lift-off TWR sits around 1.5-2.5; anything above 3 pins the dial, which still reads as "very high".
const GAUGE_MIN = value("1", 0);
const GAUGE_MAX = value("1", 3);

const ZONES: GaugeZone<"1">[] = [
  {
    from: value("1", 0),
    to: value("1", 1),
    color: "var(--color-status-nogo-bg)",
  },
  {
    from: value("1", 1),
    to: value("1", 1.5),
    color: "var(--color-status-warning-bg)",
  },
  { from: value("1", 1.5), to: value("1", 3), color: "var(--color-accent-fg)" },
];

type Tone = "ok" | "warn" | "lost";

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

function toneFor(twr: Value<"1">): Tone {
  if (twr.lessThan(1)) return "lost";
  if (twr.lessThan(1.5)) return "warn";
  return "ok";
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
  const variant: "tiny" | "small" | "normal" =
    rows < 3 || cols < 3 ? "tiny" : rows < 4 || cols < 4 ? "small" : "normal";
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

  const sparkRef = useRef<HTMLDivElement>(null);
  const [sparkWidth, setSparkWidth] = useState(120);
  useEffect(() => {
    const el = sparkRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      if (width > 0) setSparkWidth(Math.max(40, Math.floor(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const tone = toneFor(twr);

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
                color: TONE_COLOR[tone],
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
                color={TONE_COLOR[tone]}
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
