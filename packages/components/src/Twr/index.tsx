import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { STANDARD_GRAVITY, value } from "@ksp-gonogo/sitrep-sdk";
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

// Dial range in TWR units. Most rockets sit between 1.5 and 2.5 at lift-off;
// 3 is a comfortable upper bound. Anything beyond reads as pinned-max, fine
// because the qualitative information ("very high TWR") is preserved.
// `"1"` is the dimensionless token the contract already declares for a
// thrust-to-weight ratio (`vessel.propulsion.twrVac` and its two siblings), so
// the gauge's axis is the same kind as the reading that drives it.
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

function toneFor(twr: number): Tone {
  if (twr < 1) return "lost";
  if (twr < 1.5) return "warn";
  return "ok";
}

function TwrComponent({ w, h }: Readonly<ComponentProps<TwrConfig>>) {
  // The wire carries thrust and mass, not their ratio, so the headline is the
  // same arithmetic as the sparkline on the latest reading.
  const propulsionReading = useTelemetry("vessel.propulsion");
  const propulsion =
    propulsionReading.state === "observed" ||
    propulsionReading.state === "stale"
      ? propulsionReading.value
      : undefined;
  const thrust = magnitudeOf(propulsion?.currentThrust);
  const mass = magnitudeOf(propulsion?.totalMass);
  const twr =
    thrust === null || mass === null
      ? undefined
      : (twrOf(thrust, mass) ?? undefined);
  /*
   * The figure is HELD and captioned rather than withheld. This widget's whole
   * content is the one number, and its empty state says there is no engine, so
   * nulling a dated TWR would tell the operator something false about the
   * craft rather than about the link.
   *
   * A caption rather than the mark `Gauge` can now draw, because the mark
   * needs a `Reading` of the figure it draws, and this figure is arithmetic
   * over one rather than an observation of its own.
   */
  const twrNotCurrent = propulsionReading.state === "stale";
  // The sparkline history is computed here off `vessel.propulsion`'s own
  // history: the wire carries thrust and mass, not their ratio.
  const series = useComputedSeries(
    "vessel.propulsion.currentThrust",
    "vessel.propulsion.totalMass",
    SPARK_WINDOW_SEC,
    twrOf,
  );
  const sparkValues = series.v as number[];

  // Three layouts driven by widget size:
  //   tiny: single big numeric readout, no gauge, no sparkline.
  //   small: gauge only.
  //   normal: gauge + sparkline + subtitle.
  // Switching by widget size (rows/cols) rather than by container pixels
  // keeps the breakpoint deterministic and avoids the size-dependent
  // ResizeObserver feedback that arises when the inner widgets fight each
  // other for the leftover space.
  const cols = w ?? 4;
  const rows = h ?? 5;
  const variant: "tiny" | "small" | "normal" =
    rows < 3 || cols < 3 ? "tiny" : rows < 4 || cols < 4 ? "small" : "normal";
  const showSparkline = variant === "normal";
  // Subtitle elaborates the "per-stage" context, but at the registered
  // defaultSize (4×5) the gauge arc visually overlaps the subtitle row.
  // Show it only when there's clear room, i.e. at cols ≥ 5, beyond the
  // default. The PanelTitle "TWR" covers the at-a-glance read either way.
  const showSubtitle = variant === "normal" && cols >= 5;

  // Measure the gauge slot so the SVG fills it responsively. Falls back to
  // fixed defaults when ResizeObserver hasn't fired (initial render, tests).
  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 200, h: 110 });

  // Size the dial to the measured slot width, but also cap it, both by an
  // absolute width and by a slice of the widget's height, so the SVG can't
  // overflow the slot. Without the cap the fallback 200px width clips at the
  // 4×5 default and overflows almost entirely at the 3×3 small variant.
  // Height is derived from the gauge's 0.55 aspect ratio so the SVG box never
  // exceeds the room the sparkline + title leave it.
  const gaugeMaxH = Math.max(64, rows * 25 * 0.4);
  const gaugeW = Math.min(
    gaugeSize.w || 200,
    220,
    Math.round(gaugeMaxH / 0.55),
  );
  const gaugeH = Math.round(gaugeW * 0.55);

  // Sparkline width follows its slot: a fixed-pixel sparkline spills out of
  // narrow widget columns and overlaps the title row.
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

  if (twr === undefined || !Number.isFinite(twr)) {
    return (
      <Panel
        panelTitle="TWR"
        sections={
          <Section full>
            {/* Tiny widget has ~70 px of inner width, the full "No engine
                data" sentence clips to just "No". A single em-dash conveys
                "no data" without crowding the panel; the panel title alone
                tells the operator what the widget is. */}
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
            {/* 32 px TinyValue + 13 px TinyUnit + 4 px gap = ~70 px on a
                two-character value, which clips the leading digit of "1.82"
                into ".82" at 72 px inner width. Scale the readout font and
                drop the explicit "g" unit at this size, the panel title is
                "TWR", the unit is implied. */}
            {/* Dimmed rather than captioned: at this width there is no room
                for the word mark the larger layout draws, and a held figure
                still has to be readable. */}
            <span
              style={{
                ...TINY_VALUE_STYLE,
                color: TONE_COLOR[tone],
                ...(twrNotCurrent ? { opacity: 0.55 } : {}),
              }}
            >
              {twr.toFixed(1)}
            </span>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="TWR"
      /* Panel's own centring, where `Body` hand-rolled the `flex: 1` +
         `justify-content: center` pair. The widget is a dial and a trend line
         sized to the tile, which is what `fitToSize` is for, and Panel measures
         before it centres so overflowing content still starts at the top. */
      fitToSize
      sections={[
        showSubtitle && (
          <Section key="caption" full>
            <Text tone="muted" size="xs">
              Current stage · last {writeQuantity(value("s", SPARK_WINDOW_SEC))}
            </Text>
          </Section>
        ),
        twrNotCurrent && (
          <Section key="dated" full>
            {/* The fact and nothing else. The robotics console names WHICH
                half of its panel is dated because it has several; this widget
                draws one figure, so there is no ambiguity for a second clause
                to resolve and it would be prose. */}
            <Text tone="warn" size="xs" role="status" aria-live="polite">
              TWR no longer current
            </Text>
          </Section>
        ),
        <Section key="gauge" full>
          <div ref={gaugeRef} style={GAUGE_SLOT_STYLE}>
            <Gauge
              value={value("1", twr)}
              min={GAUGE_MIN}
              max={GAUGE_MAX}
              zones={ZONES}
              width={gaugeW}
              height={gaugeH}
              ariaLabel={`TWR ${writeQuantity(value("1", twr))}`}
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

/*
 * Width follows the slot via ResizeObserver: fixed-pixel sparklines used to
 * spill out of narrow columns and paint over the title.
 *
 * The top margin tops the section grid's 12px row gap up to the 20px measured
 * clearance the Gauge above needs. The Gauge SVG draws its value label inside
 * its own bottom strip, flush with the SVG box edge, and at the 4x5 default the
 * two collide below 20px. That makes this measured clearance rather than a
 * rhythm step, so it stays off the spacing ladder.
 */
const SPARK_SLOT_STYLE = {
  width: "100%",
  height: "24px",
  flex: "0 0 auto",
  marginTop: "8px",
} as const;

/*
 * 24px keeps a three-character value ("1.8") within ~50px so the leading digit
 * doesn't clip at the panel's ~70px inner width. The panel title "TWR" supplies
 * the unit context. Comment-locked to that box width, so off the type scale,
 * which in any case stops at 16px.
 */
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
