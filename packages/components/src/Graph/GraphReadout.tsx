import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { deriveReading, seriesKeyOf, value } from "@ksp-gonogo/sitrep-sdk";
import { Readout, Sparkline } from "@ksp-gonogo/ui";
import { NULL_DISPLAY, Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { GraphSeries } from "./GraphSeries";
import { paletteColor } from "./palette";
import { formatReadoutValue } from "./ticks";
import type { GraphSeries as GraphSeriesSpec } from "./types";

interface Props {
  title?: string;
  headerActions?: ReactNode;
  cfg: GraphSeriesSpec;
  meta: DataKeyMeta | undefined;
  raw: SeriesRange<number>;
  containerRef: RefObject<HTMLDivElement>;
  /** Whether this series still needs its own fetcher mounted, false when it arrived via `computedSeries`. */
  needsFetch: boolean;
  windowSec: number;
  onData: (key: string, data: SeriesRange<number>) => void;
}

/** The `"readout"` variant: the latest value plus a trend sparkline, in place of the full chart. */
export function GraphReadout({
  title,
  headerActions,
  cfg,
  meta,
  raw,
  containerRef,
  needsFetch,
  windowSec,
  onData,
}: Readonly<Props>) {
  const sparkValues = raw.v as number[];
  const latest =
    sparkValues.length > 0 ? sparkValues[sparkValues.length - 1] : undefined;
  const color = cfg.color ?? paletteColor(0);
  const seriesLabel = cfg.label ?? meta?.label ?? seriesKeyOf(cfg.source);
  const unit = meta?.unit && meta.unit !== "raw" ? meta.unit : undefined;
  // The newest sample is a model's figure, not a measurement, when a reckoned run reaches it.
  const modelled = (raw.reckoned ?? []).some(
    (run) => run.to >= sparkValues.length - 1,
  );

  /*
   * The series only records samples that arrived, so a topic that goes quiet adds none and the newest one still reads as measured. The topic's own reading knows it has stopped vouching for that figure, so the headline takes its currency from it.
   */
  const topicReading = useStream<unknown>(cfg.source.topic);
  const headline =
    latest === undefined || !unit
      ? undefined
      : topicReading.state === "held"
        ? deriveReading(
            topicReading,
            () => value(unit, latest),
            () => value(unit, latest),
          )
        : value(unit, latest);

  // The series label is dropped when it would only repeat the title.
  const readoutTitle = title ?? "GRAPH";
  return (
    <Panel
      panelTitle={readoutTitle}
      panelAside={headerActions}
      panelTrend={({ w, h }) => (
        <Sparkline
          values={sparkValues}
          width={w}
          height={h}
          color={color}
          aria-label={`${seriesLabel} trend`}
        />
      )}
      sections={
        <Section fill>
          <div ref={containerRef} style={READOUT_BODY}>
            {seriesLabel !== readoutTitle && (
              <div style={READOUT_LABEL}>{seriesLabel}</div>
            )}
            <Readout
              size="hero"
              aria-label={`${seriesLabel} ${latest ?? "no data"}`}
            >
              {latest === undefined ? (
                NULL_DISPLAY
              ) : unit ? (
                <Unit
                  value={headline}
                  marked={modelled ? MODELLED : undefined}
                />
              ) : (
                formatReadoutValue(latest)
              )}
            </Readout>
          </div>
          {needsFetch && (
            <GraphSeries
              key={cfg.id}
              source={cfg.source}
              windowSec={windowSec}
              onData={onData}
            />
          )}
        </Section>
      }
    />
  );
}

const MODELLED = {
  kind: "modelled",
  caption: "Newest point is modelled, not measured",
} as const;

const READOUT_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  position: "relative",
};

const READOUT_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
  flex: "0 0 auto",
};
