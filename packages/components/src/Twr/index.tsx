import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import {
  EmptyState,
  Gauge,
  type GaugeZone,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Sparkline,
  useElementSize,
} from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

type TwrConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 60;

// Dial range in TWR units. Most rockets sit between 1.5 and 2.5 at lift-off;
// 3 is a comfortable upper bound. Anything beyond reads as pinned-max — fine
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
  // `vessel.state.twr` field — TWR = currentThrust/(totalMass·g), computed
  // client-side off `vessel.propulsion`. Once that channel is carried the
  // headline value reads straight off the stream; no Telemachus read remains
  // for this widget's live value.
  const twr = useStream<VesselState>("vessel.state")?.twr ?? undefined;
  // The sparkline history stays on `useDataSeries` (its own stream shim).
  // A DERIVED topic has a live value but no buffered history, so this series
  // resolves off the legacy path until a raw-input-backed history exists —
  // see `useDataSeries`'s doc comment; the headline value above never
  // touches Telemachus regardless.
  const series = useDataSeries("data", "dv.currentTWR", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];

  // Three layouts driven by widget size:
  //   tiny — single big numeric readout, no gauge, no sparkline.
  //   small — gauge only.
  //   normal — gauge + sparkline + subtitle.
  // Switching by widget size (rows/cols) rather than by container pixels
  // keeps the breakpoint deterministic and avoids the size-dependent
  // ResizeObserver feedback we used to hit when the inner widgets fought
  // each other for the leftover space.
  const cols = w ?? 4;
  const rows = h ?? 5;
  const variant: "tiny" | "small" | "normal" =
    rows < 3 || cols < 3 ? "tiny" : rows < 4 || cols < 4 ? "small" : "normal";
  const showSparkline = variant === "normal";
  // Subtitle elaborates the "per-stage" context, but at the registered
  // defaultSize (4×5) the gauge arc visually overlaps the subtitle row.
  // Show it only when there's clear room — i.e. at cols ≥ 5, beyond the
  // default. The PanelTitle "TWR" covers the at-a-glance read either way.
  const showSubtitle = variant === "normal" && cols >= 5;

  // Measure the gauge slot so the SVG fills it responsively. Falls back to
  // fixed defaults when ResizeObserver hasn't fired (initial render, tests).
  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 200, h: 110 });

  // Size the dial to the measured slot width, but also cap it — both by an
  // absolute width and by a slice of the widget's height — so the SVG can't
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

  // Sparkline width follows its slot — fixed-pixel sparklines used to spill
  // out of narrow widget columns and overlap the title row.
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
      <Panel>
        <PanelTitle>TWR</PanelTitle>
        {/* Tiny widget has ~70 px of inner width — the full "No engine
            data" sentence clips to just "No". A single em-dash conveys
            "no data" without crowding the panel; the panel title alone
            tells the operator what the widget is. */}
        <EmptyState>{variant === "tiny" ? "—" : "No engine data"}</EmptyState>
      </Panel>
    );
  }

  const tone = toneFor(twr);

  if (variant === "tiny") {
    return (
      <Panel>
        <PanelTitle>TWR</PanelTitle>
        <TinyBody>
          {/* 32 px TinyValue + 13 px TinyUnit + 4 px gap = ~70 px on a
              two-character value, which clips the leading digit of "1.82"
              into ".82" at 72 px inner width. Scale the readout font and
              drop the explicit "g" unit at this size — the panel title is
              "TWR", the unit is implied. */}
          <TinyValue $color={TONE_COLOR[tone]}>{twr.toFixed(1)}</TinyValue>
        </TinyBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>TWR</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle>Current stage · last {SPARK_WINDOW_SEC}s</PanelSubtitle>
      )}
      <Body>
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
     below it — at the 4×5 default the two used to collide. */
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
  /* Width follows the slot via ResizeObserver — fixed-pixel sparklines used
     to spill out of narrow columns and paint over the title. */
  width: 100%;
  height: 24px;
  flex: 0 0 auto;
`;

const TinyBody = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 0;
`;

const TinyValue = styled.span<{ $color: string }>`
  /* 24 px keeps a three-character value ("1.8") within ~50 px so the
     leading digit doesn't clip at the panel's ~70 px inner width. The
     panel title "TWR" supplies the unit context. */
  font-size: 24px;
  font-weight: 700;
  color: ${(p) => p.$color};
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1;
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
  dataRequirements: ["dv.currentTWR"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { TwrComponent };
