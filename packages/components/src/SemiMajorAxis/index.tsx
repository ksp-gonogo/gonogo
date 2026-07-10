import type { ComponentProps } from "@ksp-gonogo/core";
import {
  formatDistance,
  registerComponent,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import {
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Sparkline,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  // R6 Wave 1 — both reads are now clean-home stream Topics (no gaps left),
  // so this widget rides the Uplink stream end-to-end. Read via `useTelemetry`
  // (the canonical read hook — `useDataValue` is a deprecated alias): the
  // two-arg form resolves each key through `mapTopic` to its stream home —
  // `o.sma` -> the raw `vessel.orbit.sma` field-subtopic, `o.referenceBody` ->
  // the derived `vessel.state.referenceBodyName` display-map (the SDK resolves
  // `vessel.orbit.referenceBodyIndex` against `system.bodies`). Neither key is
  // gapped anymore; the Telemachus read-fallback is exercised nowhere in this
  // widget's own tests (see `stream.test.tsx` / `dual-run.test.tsx`).
  const sma = useTelemetry<number>("data", "o.sma");
  const referenceBody = useTelemetry<string>("data", "o.referenceBody");
  // `useDataSeries` (sparkline history) carries the same stream shim — `o.sma`
  // maps to the raw `vessel.orbit.sma` field-subtopic, so once `vessel.orbit`
  // is carried this sparkline reads its window straight off the
  // `TimelineStore`'s buffered history, same as the headline `sma` value
  // above. See `stream.test.tsx` for the end-to-end proof.
  const series = useDataSeries("data", "o.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];
  // Connectivity indicator keyed off the headline `o.sma` -> `vessel.orbit.sma`.
  const streamStatus = useDataStreamStatus("data", "o.sma");

  const cols = w ?? 4;
  const rows = h ?? 4;
  // Subtitle is "what is this widget" elaboration — suppress when there's
  // no room without crowding the readout. At default 4×4 the PanelTitle
  // ("SMA") + value already cover the operator's read-at-a-glance need.
  const showSubtitle = rows >= 5 && cols >= 4;
  const showSparkline = rows >= 4 && cols >= 3;

  // Readout font scales with available width so the value (e.g.
  // "2.87 Mm", "680.0 km") doesn't wrap onto two lines at narrow column
  // counts. Wrap was the underlying cause of the readout overlapping the
  // subtitle on small widgets — keep it on one line and the layout
  // resolves itself.
  const readoutFontPx = cols <= 3 ? 18 : cols <= 4 ? 22 : 28;

  // Sparkline width tracks its slot. The Sparkline renders a fixed-width
  // SVG (no intrinsic responsiveness), so we measure the slot and feed it
  // an explicit pixel width. The measurement lives on a *callback ref*
  // rather than a `[]`-deps effect: the sparkline only mounts once orbit
  // data arrives (before that the widget shows the EmptyState branch and
  // SparkSlot is absent from the tree). A mount-time effect would run
  // against a null ref and never re-attach when the slot later appears,
  // leaving the width pinned at its 120-px default. The callback ref fires
  // exactly when the node attaches/detaches.
  const roRef = useRef<ResizeObserver | null>(null);
  const [sparkWidth, setSparkWidth] = useState(120);
  const sparkRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = (width: number) => {
      if (width > 0) {
        setSparkWidth((prev) => {
          const next = Math.max(40, Math.floor(width));
          return prev === next ? prev : next;
        });
      }
    };
    measure(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      measure(entries[0].contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  if (sma === undefined || !Number.isFinite(sma)) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>SMA</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        <EmptyState>No orbit data</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>SMA</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && (
        <PanelSubtitle>
          Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
        </PanelSubtitle>
      )}
      <Body>
        <Readout
          role="status"
          aria-live="polite"
          style={{ fontSize: `${readoutFontPx}px` }}
        >
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

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
  white-space: nowrap;
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
  requires: ["flight"],
});

export { SemiMajorAxisComponent };
