import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
import { BigReadout, ReadoutCaption, Sparkline } from "@ksp-gonogo/ui";
import { NULL_DISPLAY, Panel, Section } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { GraphSeries } from "./GraphSeries";
import { paletteColor } from "./palette";
import { formatReadoutValue } from "./ticks";
import type { GraphSeriesConfig } from "./types";

interface Props {
  title?: string;
  headerActions?: ReactNode;
  cfg: GraphSeriesConfig;
  meta: DataKeyMeta | undefined;
  raw: SeriesRange<number>;
  containerRef: RefObject<HTMLDivElement>;
  size: { w: number; h: number } | null;
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
  size,
  needsFetch,
  windowSec,
  onData,
}: Readonly<Props>) {
  const sparkValues = raw.v as number[];
  const latest =
    sparkValues.length > 0 ? sparkValues[sparkValues.length - 1] : undefined;
  const color = cfg.color ?? paletteColor(0);
  const seriesLabel = cfg.label ?? meta?.label ?? cfg.key;
  const unit = meta?.unit;

  // The series label is dropped when it would only repeat the title.
  const readoutTitle = title ?? "GRAPH";
  return (
    <Panel
      panelTitle={readoutTitle}
      panelAside={headerActions}
      sections={
        <Section fill>
          <div ref={containerRef} style={READOUT_BODY}>
            {seriesLabel !== readoutTitle && (
              <div style={READOUT_LABEL}>{seriesLabel}</div>
            )}
            <BigReadout aria-label={`${seriesLabel} ${latest ?? "no data"}`}>
              {latest !== undefined ? formatReadoutValue(latest) : NULL_DISPLAY}
              {unit && <ReadoutCaption>{unit}</ReadoutCaption>}
            </BigReadout>
            <div style={SPARK_SLOT}>
              {size && (
                <Sparkline
                  values={sparkValues}
                  width={size.w}
                  height={Math.min(80, Math.max(24, Math.floor(size.h * 0.35)))}
                  color={color}
                  ariaLabel={`${seriesLabel} trend`}
                />
              )}
            </div>
          </div>
          {needsFetch && (
            <GraphSeries
              key={cfg.id}
              dataKey={cfg.key}
              windowSec={windowSec}
              onData={onData}
            />
          )}
        </Section>
      }
    />
  );
}

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

const SPARK_SLOT: CSSProperties = { width: "100%", flex: "0 0 auto" };
