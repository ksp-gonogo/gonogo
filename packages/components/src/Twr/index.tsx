import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { useDataSeries } from "@gonogo/data";
import {
  EmptyState,
  Gauge,
  type GaugeZone,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Sparkline,
} from "@gonogo/ui";
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

function TwrComponent(_props: Readonly<ComponentProps<TwrConfig>>) {
  const twr = useDataValue<number>("data", "dv.currentTWR");
  const series = useDataSeries("data", "dv.currentTWR", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];

  // Measure the gauge slot so the SVG fills it responsively. Falling back
  // to fixed defaults keeps the test renderer happy when the ResizeObserver
  // shim doesn't fire.
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [gaugeSize, setGaugeSize] = useState({ w: 200, h: 110 });
  useEffect(() => {
    const el = gaugeRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setGaugeSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (twr === undefined || !Number.isFinite(twr)) {
    return (
      <Panel>
        <PanelTitle>TWR</PanelTitle>
        <EmptyState>No engine data</EmptyState>
      </Panel>
    );
  }

  const tone = toneFor(twr);

  return (
    <Panel>
      <PanelTitle>TWR</PanelTitle>
      <PanelSubtitle>Current stage · last {SPARK_WINDOW_SEC}s</PanelSubtitle>
      <Body>
        <GaugeSlot ref={gaugeRef}>
          <Gauge
            value={twr}
            min={GAUGE_MIN}
            max={GAUGE_MAX}
            zones={ZONES}
            width={gaugeSize.w}
            height={gaugeSize.h}
            valueLabel={twr.toFixed(2)}
            unitLabel="g"
            ariaLabel={`TWR ${twr.toFixed(2)}`}
          />
        </GaugeSlot>
        <SparkSlot>
          <Sparkline
            values={sparkValues}
            width={120}
            height={20}
            color={TONE_COLOR[tone]}
            ariaLabel="TWR trend"
          />
        </SparkSlot>
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
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
  width: 120px;
  height: 20px;
  flex: 0 0 auto;
`;

registerComponent<TwrConfig>({
  id: "twr",
  name: "TWR",
  description:
    "Thrust-to-weight ratio of the active stage as a dial. Red below 1 (can't lift off), amber 1–1.5, green above. Sparkline shows the last minute.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 4 },
  component: TwrComponent,
  dataRequirements: ["dv.currentTWR"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { TwrComponent };
