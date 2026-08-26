import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Gauge, type GaugeZone, Sparkline } from "@ksp-gonogo/ui";
import {
  EmptyState,
  NULL_DISPLAY,
  Panel,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

// Dial range in TWR units. Most rockets sit between 1.5 and 2.5 at lift-off;
// 3 is a comfortable upper bound. Anything beyond reads as pinned-max, fine
// because the qualitative information ("very high TWR") is preserved.
const GAUGE_MIN = 0;
const GAUGE_MAX = 3;

const ZONES: GaugeZone[] = [
  { from: 0, to: 1, color: "var(--color-status-nogo-bg)" },
  { from: 1, to: 1.5, color: "var(--color-status-warning-bg)" },
  { from: 1.5, to: 3, color: "var(--color-accent-fg)" },
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
  // `dv.currentTWR` is MAPPED (`map-topic.ts`) to the derived
  // `vessel.state.twr` field: TWR = currentThrust/(totalMass·g), computed
  // client-side off `vessel.propulsion`. Once that channel is carried the
  // headline value reads straight off the stream; no legacy read remains
  // for this widget's live value.
  const twr = useStream<VesselState>("vessel.state")?.twr ?? undefined;
  // The sparkline history reads the same derived field the headline does.
  // A derived topic has a live value but no buffered history of its own, so
  // `useDataSeries` replays the channel's `derive()` across the window off the
  // buffered history of its RAW inputs; see that hook's doc comment.
  const series = useDataSeries("data", "vessel.state.twr", SPARK_WINDOW_SEC);
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
      <Panel panelTitle="TWR">
        {/* Tiny widget has ~70 px of inner width, the full "No engine
            data" sentence clips to just "No". A single em-dash conveys
            "no data" without crowding the panel; the panel title alone
            tells the operator what the widget is. */}
        <EmptyState>
          {variant === "tiny" ? NULL_DISPLAY : "No engine data"}
        </EmptyState>
      </Panel>
    );
  }

  const tone = toneFor(twr);

  if (variant === "tiny") {
    return (
      <Panel panelTitle="TWR" fitToSize>
        <>
          {/* 32 px TinyValue + 13 px TinyUnit + 4 px gap = ~70 px on a
              two-character value, which clips the leading digit of "1.82"
              into ".82" at 72 px inner width. Scale the readout font and
              drop the explicit "g" unit at this size, the panel title is
              "TWR", the unit is implied. */}
          <TinyValue $color={TONE_COLOR[tone]}>{twr.toFixed(1)}</TinyValue>
        </>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="TWR">
      <Body>
        {showSubtitle && (
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            Current stage · last {writeQuantity(value("s", SPARK_WINDOW_SEC))}
          </div>
        )}
        <GaugeSlot ref={gaugeRef}>
          <Gauge
            value={twr}
            min={GAUGE_MIN}
            max={GAUGE_MAX}
            zones={ZONES}
            width={gaugeW}
            height={gaugeH}
            valueLabel={twr.toFixed(2)}
            ariaLabel={`TWR ${twr.toFixed(2)}`}
          />
        </GaugeSlot>
        {showSparkline && (
          <SparkSlot ref={sparkRef}>
            <Sparkline
              values={sparkValues}
              width={sparkWidth}
              height={24}
              color={TONE_COLOR[tone]}
              ariaLabel="TWR trend"
            />
          </SparkSlot>
        )}
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  /* The Gauge SVG draws its value label inside its own bottom strip, flush
     with the SVG box edge. A generous gap keeps that label off the sparkline
     below it: at the 4×5 default the two collide without it. That makes this
     measured clearance rather than a rhythm step, so it stays off the
     spacing ladder, and snapping 20 -> 16 is the direction that reproduces
     the collision. */
  gap: 20px;
  min-height: 0;
`;

const GaugeSlot = styled.div`
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const SparkSlot = styled.div`
  /* Width follows the slot via ResizeObserver: fixed-pixel sparklines used
     to spill out of narrow columns and paint over the title. */
  width: 100%;
  height: 24px;
  flex: 0 0 auto;
`;

const TinyValue = styled.span<{ $color: string }>`
  /* 24 px keeps a three-character value ("1.8") within ~50 px so the
     leading digit doesn't clip at the panel's ~70 px inner width. The
     panel title "TWR" supplies the unit context. Comment-locked to that box
     width, so off the type scale, which in any case stops at 16px. */
  font-size: 24px;
  font-weight: 700;
  color: ${(p) => p.$color};
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: var(--line-height-flush);
  white-space: nowrap;
`;

registerComponent<TwrConfig>({
  id: "twr",
  name: "TWR",
  description:
    "Thrust-to-weight ratio of the active stage as a dial. Red below 1 (can't lift off), amber 1–1.5, green above. Sparkline shows the last minute.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 2, h: 2 },
  component: TwrComponent,
  dataRequirements: ["vessel.state.twr"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { TwrComponent };
