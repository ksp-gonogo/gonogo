import { getSizeBucket } from "@ksp-gonogo/core";
import type {
  DataKeyMeta,
  SeriesRange,
  SeriesTimeBasis,
} from "@ksp-gonogo/data";
import { useTopicFieldCatalog } from "@ksp-gonogo/data";
import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import type { ChartSeries, ThresholdRule } from "@ksp-gonogo/ui";
import { LineChart, utXTickFormat } from "@ksp-gonogo/ui";
import { FramedDisplay, Panel, Section } from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  computeXDomain,
  resolveAxes,
  timeWindowDomain,
  withDefaults,
} from "./axes";
import { GraphFetchers } from "./GraphFetchers";
import { GraphReadout } from "./GraphReadout";
import {
  computeFullTitle,
  computeUnitsLabel,
  resolvePanelTitle,
} from "./header";
import { buildLiveSeries } from "./liveSeries";
import { formatNumericTick, unitTick } from "./ticks";
import type { ComputedSeries, GraphConfig, GraphVariant } from "./types";
import { TIME_AXIS } from "./types";

/** A caller-sampled static curve overlaid on a non-time chart, as parallel `xs` / `ys` arrays; nothing is subscribed for it. */
export interface ReferenceCurve {
  /** Stable ID; must not collide with any series ID. */
  id: string;
  label: string;
  xs: number[];
  ys: number[];
  /** CSS color, a dim accent when omitted. */
  color?: string;
  /** Which Y axis the curve belongs to, `"primary"` when omitted. */
  axis?: "primary" | "secondary";
}

export interface GraphViewProps {
  config: GraphConfig | undefined;
  referenceCurves?: ReadonlyArray<ReferenceCurve>;
  /** Overrides the panel header, which otherwise names the plotted units. */
  title?: string;
  emptyState?: string;
  /** Forwarded to `panelAside`. Not for a stream-status badge: the panel already renders one. */
  headerActions?: ReactNode;
  /** Everything drawn on the plot beyond its series, in the plot's own data space. */
  layers?: readonly PlotLayer[];
  /** Series the widget computed, each with the metadata a schema entry would give it; a series whose `key` appears here is drawn from `data` and never fetched. */
  computedSeries?: readonly ComputedSeries[];
  /** Drop the panel chrome and render the framed chart alone, for a plot composed inside another widget's layout. */
  chrome?: "panel" | "bare";
  /** Names what the chart is, before its layers add their own clauses. Only read while `chrome` is `"bare"`. */
  ariaLabel?: string;
  /** Widget grid size, which resolves the `"auto"` display variant. */
  w?: number;
  h?: number;
}

/** Referentially stable, so an unlayered chart does not remount its layer renderer every render. */
const EMPTY_LAYERS: readonly PlotLayer[] = Object.freeze([]);

export function GraphView({
  config,
  referenceCurves,
  title,
  emptyState = "Configure series to begin graphing.",
  headerActions,
  layers: ownLayers,
  computedSeries,
  chrome = "panel",
  ariaLabel,
  w,
  h,
}: GraphViewProps) {
  const series = useMemo(
    () => (config?.series ?? []).map(withDefaults),
    [config?.series],
  );
  const layers = ownLayers ?? EMPTY_LAYERS;

  const windowSec = config?.windowSec ?? 300;
  const xKey = config?.xKey ?? TIME_AXIS;
  const xPinned = config?.xDomain !== undefined;
  const xIsTime = !xPinned && xKey === TIME_AXIS;

  const catalog = useTopicFieldCatalog();
  const metaMap = useMemo(() => {
    const map = new Map<string, DataKeyMeta>(catalog.map((k) => [k.key, k]));
    for (const c of computedSeries ?? []) map.set(c.meta.key, c.meta);
    return map;
  }, [catalog, computedSeries]);
  const xMeta = xIsTime || xPinned ? null : (metaMap.get(xKey) ?? null);
  const axes = resolveAxes(series, metaMap);

  const units = useMemo(
    () =>
      title !== undefined
        ? ""
        : computeUnitsLabel(series, metaMap, axes, xIsTime, xMeta, xKey),
    [title, series, metaMap, axes, xIsTime, xMeta, xKey],
  );

  const fullTitle = useMemo(
    () => (title !== undefined ? undefined : computeFullTitle(series, metaMap)),
    [title, series, metaMap],
  );

  const requestedVariant: GraphVariant = config?.variant ?? "auto";
  const hasReferenceCurves = !!referenceCurves && referenceCurves.length > 0;
  const sizeBucket = getSizeBucket(w, h);
  const canReadout =
    series.length === 1 && !hasReferenceCurves && layers.length === 0;
  // At `small` the chart's axes and legend squash enough that a number and sparkline read better.
  const autoShouldReadout = sizeBucket === "tiny" || sizeBucket === "small";
  function resolveVariant(): "chart" | "readout" {
    if (!canReadout) return "chart";
    if (requestedVariant === "readout") return "readout";
    if (requestedVariant === "auto" && autoShouldReadout) return "readout";
    return "chart";
  }
  const resolvedVariant = resolveVariant();

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bind the observer when the variant flips, chart and readout share `containerRef` but render different elements, so the ref points to a fresh node.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolvedVariant]);

  const [fetchedData, setSeriesData] = useState<
    Map<string, SeriesRange<number>>
  >(new Map());
  const seriesData = useMemo(() => {
    if (!computedSeries?.length) return fetchedData;
    const merged = new Map(fetchedData);
    for (const c of computedSeries) merged.set(c.meta.key, c.data);
    return merged;
  }, [fetchedData, computedSeries]);
  const computedKeys = useMemo(
    () => new Set((computedSeries ?? []).map((c) => c.meta.key)),
    [computedSeries],
  );
  const [xData, setXData] = useState<SeriesRange<number>>({ t: [], v: [] });

  // Clear stale X buffer when the X key changes; otherwise the first frame after reconfigure pairs new Y against the previous key's values.
  // biome-ignore lint/correctness/useExhaustiveDependencies: xKey is a trigger, not a read inside the body
  useEffect(() => {
    setXData({ t: [], v: [] });
  }, [xKey]);

  const handleData = useCallback((key: string, data: SeriesRange<number>) => {
    setSeriesData((prev) => {
      const next = new Map(prev);
      next.set(key, data);
      return next;
    });
  }, []);

  const handleXData = useCallback((_key: string, data: SeriesRange<number>) => {
    setXData(data);
  }, []);

  const hasThirdUnit = (() => {
    const units = series.map((c) => metaMap.get(c.key)?.unit ?? "raw");
    return new Set(units).size > 2;
  })();

  const liveSeries: ChartSeries[] = buildLiveSeries(
    series,
    metaMap,
    seriesData,
    axes,
    xIsTime,
    xData,
  );

  const extraFetchKeys = series
    .filter((cfg) => cfg.type === "band" && cfg.keyHigh)
    .map((cfg) => cfg.keyHigh as string);

  // Reference curves are functions of X, so a time-axis graph skips them.
  const overlaySeries: ChartSeries[] =
    !xIsTime && referenceCurves
      ? referenceCurves.map((curve) => ({
          id: `__ref_${curve.id}`,
          label: curve.label,
          axis: curve.axis ?? "primary",
          color: curve.color ?? "var(--color-text-faint)",
          type: "line" as const,
          dashed: true,
          data: { x: curve.xs, y: curve.ys },
        }))
      : [];

  const chartSeries: ChartSeries[] = [...liveSeries, ...overlaySeries];

  const reckonedWindowEnd = series.reduce<number | undefined>(
    (furthest, cfg) => {
      const raw = seriesData.get(cfg.key);
      const end =
        raw && (raw.reckoned?.length ?? 0) > 0 ? raw.windowEndAt : undefined;
      if (end === undefined) return furthest;
      return furthest === undefined || end > furthest ? end : furthest;
    },
    undefined,
  );

  function resolveXDomain(): [number, number] {
    if (xPinned) return config?.xDomain as [number, number];
    if (xIsTime)
      return timeWindowDomain(liveSeries, windowSec, reckonedWindowEnd);
    return computeXDomain(xData.v as number[], overlaySeries, layers);
  }
  const xDomain = resolveXDomain();

  // The clock the samples are stamped against, as the fetcher declared it; the first series with samples decides.
  const timeBasis: SeriesTimeBasis =
    series
      .map((cfg) => seriesData.get(cfg.key))
      .find((range) => range !== undefined && range.t.length > 0)?.basis ??
    "wall-ms";

  function resolveXTickFormat():
    | ((value: number, domain: readonly [number, number]) => string)
    | undefined {
    if (xIsTime) return timeBasis === "ut-seconds" ? utXTickFormat : undefined;
    if (xPinned && config?.xUnit) {
      const unit = config.xUnit;
      return (v: number) => unitTick(unit, v);
    }
    return (v: number) => formatNumericTick(v, xMeta?.unit);
  }
  const xTickFormat = resolveXTickFormat();

  const yTickFormat = config?.yUnit
    ? (v: number) => unitTick(config.yUnit as string, v)
    : undefined;

  if (resolvedVariant === "readout") {
    const cfg = series[0];
    return (
      <GraphReadout
        title={title}
        headerActions={headerActions}
        cfg={cfg}
        meta={metaMap.get(cfg.key)}
        raw={seriesData.get(cfg.key) ?? { t: [], v: [] }}
        containerRef={containerRef}
        size={size}
        needsFetch={!computedKeys.has(cfg.key)}
        windowSec={windowSec}
        onData={handleData}
      />
    );
  }

  const chartBody = (
    <>
      <FramedDisplay style={CHART_FRAME}>
        <div ref={containerRef} style={CHART_AREA}>
          {size && (
            <LineChart
              series={chartSeries}
              xDomain={xDomain}
              xTickFormat={xTickFormat}
              yDomainPrimary={config?.yDomainPrimary}
              yDomainSecondary={config?.yDomainSecondary}
              yScalePrimary={config?.yScalePrimary}
              yScaleSecondary={config?.yScaleSecondary}
              yTickFormat={yTickFormat}
              thresholds={config?.thresholds as ThresholdRule[] | undefined}
              layers={layers}
              hideXAxis={config?.hideXAxis}
              spatial={config?.spatial}
              ariaLabel={ariaLabel}
              width={size.w}
              height={size.h}
            />
          )}
          {hasThirdUnit && (
            <div style={AXIS_WARNING}>Add explicit axes to plot 3+ units</div>
          )}
          {series.length === 0 &&
            overlaySeries.length === 0 &&
            layers.length === 0 && (
              <div style={EMPTY_STATE_OVERLAY}>{emptyState}</div>
            )}
        </div>
      </FramedDisplay>
      <GraphFetchers
        series={series.filter((cfg) => !computedKeys.has(cfg.key))}
        extraFetchKeys={extraFetchKeys}
        xFetchKey={!xIsTime && !xPinned ? xKey : undefined}
        windowSec={windowSec}
        onData={handleData}
        onXData={handleXData}
      />
    </>
  );

  if (chrome === "bare") return chartBody;

  return (
    <Panel
      panelTitle={resolvePanelTitle(title, units, fullTitle)}
      panelAside={headerActions}
      sections={<Section fill>{chartBody}</Section>}
    />
  );
}

// A frame, not `floatingHeader`: LineChart draws its legend top-left inside the plot, where a floating title would land.
const CHART_FRAME: CSSProperties = { flex: 1, minHeight: 0 };

const CHART_AREA: CSSProperties = {
  flex: 1,
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};

const EMPTY_STATE_OVERLAY: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  pointerEvents: "none",
};

const AXIS_WARNING: CSSProperties = {
  position: "absolute",
  bottom: "4px",
  right: "8px",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-status-warning-bg)",
  background: "rgba(0, 0, 0, 0.7)",
  padding: "var(--inset-chip)",
  borderRadius: "var(--radius-regular)",
  pointerEvents: "none",
};
