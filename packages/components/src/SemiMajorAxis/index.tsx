import type { ComponentProps } from "@gonogo/core";
import { formatDistance, registerComponent, useDataValue } from "@gonogo/core";
import { useDataSeries } from "@gonogo/data";
import {
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Sparkline,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  const sma = useDataValue<number>("data", "o.sma");
  const referenceBody = useDataValue<string>("data", "o.referenceBody");
  const series = useDataSeries("data", "o.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];

  const cols = w ?? 4;
  const rows = h ?? 4;
  const showSubtitle = rows >= 4;
  const showSparkline = rows >= 4 && cols >= 3;

  // Sparkline width tracks its slot via ResizeObserver so a narrow column
  // doesn't paint a 120-px sparkline across the title row.
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

  if (sma === undefined || !Number.isFinite(sma)) {
    return (
      <Panel>
        <PanelTitle>SMA</PanelTitle>
        <EmptyState>No orbit data</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>SMA</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle>
          Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
        </PanelSubtitle>
      )}
      <Body>
        <Readout role="status" aria-live="polite">
          {formatDistance(sma)}
        </Readout>
        {showSparkline && (
          <SparkSlot ref={sparkRef}>
            <Sparkline
              values={sparkValues}
              width={sparkWidth}
              height={28}
              ariaLabel="SMA trend"
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
  gap: 6px;
  min-height: 0;
`;

const Readout = styled.div`
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
  text-align: center;
`;

const SparkSlot = styled.div`
  width: 100%;
  height: 28px;
`;

registerComponent<SemiMajorAxisConfig>({
  id: "semi-major-axis",
  name: "Semi-major axis",
  description:
    "Semi-major axis of the current orbit (distance from the body centre, averaged across the ellipse). Determines orbital period and total energy.",
  tags: ["telemetry", "orbit"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  component: SemiMajorAxisComponent,
  dataRequirements: ["o.sma", "o.referenceBody"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { SemiMajorAxisComponent };
