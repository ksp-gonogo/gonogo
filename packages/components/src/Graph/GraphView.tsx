import type {
  DataKeyMeta,
  SeriesRange,
  SeriesTimeBasis,
} from "@ksp-gonogo/data";
import { plotColumnsOf, useTopicFieldCatalog } from "@ksp-gonogo/data";
import { type PlotLayer, seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import {
  type ChartSeries,
  Graph,
  type GraphThreshold,
  getSizeBucket,
  type ReadoutRoom,
  type ReferenceCurve,
  Text,
  utXTickFormat,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  computeXDomain,
  resolveAxes,
  timeWindowDomain,
  withDefaults,
} from "./axes";
import { axisTitle, yAxisTitle } from "./axisTitles";
import { GraphFetchers } from "./GraphFetchers";
import { GraphReadout } from "./GraphReadout";
import {
  computeFullTitle,
  computeUnitsLabel,
  resolvePanelTitle,
} from "./header";
import { buildLiveSeries } from "./liveSeries";
import { formatNumericTick } from "./ticks";
import type { ComputedSeries, GraphVariant, GraphViewConfig } from "./types";

export type {
  PresentPoint,
  ReadoutRoom,
  ReferenceCurve,
} from "@ksp-gonogo/ui-kit";

export interface GraphViewProps {
  config: GraphViewConfig | undefined;
  /** Lines across the plot, each at a quantity in its axis's unit. */
  thresholds?: readonly GraphThreshold[];
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
  "aria-label"?: string;
  /** Widget grid size, which resolves the `"auto"` display variant. */
  w?: number;
  h?: number;
  /** What the chart cannot show ("plotting trace only"). The kit places it: over an empty plot with room, beside a wide short one, below the rest. */
  notice?: ReactNode;
  /** Names each axis from the series drawn on it and the field on x, where the config gives no name. For a plot whose series the operator picked. */
  deriveAxisTitles?: boolean;
  /**
   * Figures the plot shows about the present, as one fixed card. Where the plot
   * has measured room for it, the card takes a column beside the plot, inside
   * its frame. Where it does not, the card stands over the plot in a corner no
   * trace, line or legend chip crosses, and where no corner is clear it is not
   * drawn.
   */
  plotReadout?: ReactNode | ((room: ReadoutRoom) => ReactNode);
}

/** Referentially stable, so an unlayered chart does not remount its layer renderer every render. */
const EMPTY_LAYERS: readonly PlotLayer[] = Object.freeze([]);

export function GraphView({
  config,
  thresholds,
  referenceCurves,
  title,
  emptyState = "Configure series to begin graphing",
  headerActions,
  layers: ownLayers,
  computedSeries,
  chrome = "panel",
  "aria-label": ariaLabel,
  w,
  h,
  notice,
  plotReadout,
  deriveAxisTitles,
}: GraphViewProps) {
  const series = useMemo(
    () => (config?.series ?? []).map(withDefaults),
    [config?.series],
  );
  const layers = ownLayers ?? EMPTY_LAYERS;

  const windowSec = config?.windowSec ?? 300;
  const xSource = config?.x;
  const xKey = xSource ? seriesKeyOf(xSource) : undefined;
  const xPinned = config?.xDomain !== undefined;
  const xIsTime = !xPinned && xKey === undefined;

  const catalog = useTopicFieldCatalog();
  const metaMap = useMemo(() => {
    const map = new Map<string, DataKeyMeta>(catalog.map((k) => [k.key, k]));
    for (const c of computedSeries ?? []) map.set(c.meta.key, c.meta);
    return map;
  }, [catalog, computedSeries]);
  const xMeta =
    xKey === undefined || xPinned ? null : (metaMap.get(xKey) ?? null);
  const axes = resolveAxes(series, metaMap);

  const units = useMemo(
    () =>
      title !== undefined
        ? ""
        : computeUnitsLabel(series, metaMap, axes, xIsTime, xMeta, xKey ?? ""),
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

  const [fetchedData, setSeriesData] = useState<
    Map<string, SeriesRange<number>>
  >(new Map());
  const seriesData = useMemo(() => {
    if (!computedSeries?.length) return fetchedData;
    const merged = new Map(fetchedData);
    for (const c of computedSeries)
      merged.set(c.meta.key, plotColumnsOf(c.data));
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
    const units = series.map(
      (c) => metaMap.get(seriesKeyOf(c.source))?.unit ?? "raw",
    );
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

  const extraFetches = series.flatMap((cfg) =>
    cfg.type === "band" && cfg.high ? [cfg.high] : [],
  );

  const reckonedWindowEnd = series.reduce<number | undefined>(
    (furthest, cfg) => {
      const raw = seriesData.get(seriesKeyOf(cfg.source));
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
    return computeXDomain(xData.v as number[], referenceCurves ?? [], layers);
  }
  const xDomain = resolveXDomain();

  // The clock the samples are stamped against, as the fetcher declared it; the first series with samples decides.
  const timeBasis: SeriesTimeBasis =
    series
      .map((cfg) => seriesData.get(seriesKeyOf(cfg.source)))
      .find((range) => range !== undefined && range.t.length > 0)?.basis ??
    "wall-ms";

  function resolveXTickFormat():
    | ((
        value: number,
        domain: readonly [number, number],
        ticks?: readonly number[],
      ) => string)
    | undefined {
    if (xIsTime) return timeBasis === "ut-seconds" ? utXTickFormat : undefined;
    // A pinned axis with a unit is written by the graph's own unit ladder.
    if (xPinned && config?.xUnit) return undefined;
    return (v: number) => formatNumericTick(v, xMeta?.unit);
  }
  const xTickFormat = resolveXTickFormat();
  // The crosshair's heading writes the x with the same unit vocabulary as the rest of the chart: a symbol after a space, at the kit's own precision.
  const xReadUnit = xPinned ? config?.xUnit : xMeta?.unit;
  const xReadFormat =
    xIsTime || !xReadUnit || xReadUnit === "raw"
      ? undefined
      : (v: number) => {
          try {
            return writeQuantity({ magnitude: v, unit: xReadUnit });
          } catch {
            return formatNumericTick(v, xReadUnit);
          }
        };

  const derive = deriveAxisTitles === true;
  const xAxisTitle = axisTitle(
    config?.xLabel ?? (derive ? (xIsTime ? "Time" : xMeta?.label) : undefined),
    xIsTime ? undefined : (config?.xUnit ?? xMeta?.unit),
  );
  const yAxisLabel = yAxisTitle({
    axis: "primary",
    series,
    axes,
    metaMap,
    name: config?.yLabel,
    unit: config?.yUnit,
    derive,
  });
  const ySecondaryAxisLabel = yAxisTitle({
    axis: "secondary",
    series,
    axes,
    metaMap,
    name: undefined,
    unit: undefined,
    derive,
  });

  if (resolvedVariant === "readout") {
    const cfg = series[0];
    const key = seriesKeyOf(cfg.source);
    return (
      <GraphReadout
        title={title}
        headerActions={headerActions}
        cfg={cfg}
        meta={metaMap.get(key)}
        raw={seriesData.get(key) ?? { t: [], v: [] }}
        needsFetch={!computedKeys.has(key)}
        windowSec={windowSec}
        onData={handleData}
      />
    );
  }

  return (
    <Graph
      chrome={chrome}
      title={resolvePanelTitle(title, units, fullTitle)}
      headerActions={headerActions}
      series={liveSeries}
      xDomain={xDomain}
      xTickFormat={xTickFormat}
      xReadFormat={xReadFormat}
      xUnit={xPinned && !xIsTime ? config?.xUnit : undefined}
      yUnit={config?.yUnit}
      yDomainPrimary={config?.yDomainPrimary}
      yDomainSecondary={config?.yDomainSecondary}
      yScalePrimary={config?.yScalePrimary}
      yScaleSecondary={config?.yScaleSecondary}
      thresholds={thresholds}
      referenceCurves={referenceCurves}
      layers={ownLayers}
      xKind={xIsTime ? "time" : "value"}
      xAxisLabel={xAxisTitle}
      yAxisLabel={yAxisLabel}
      ySecondaryAxisLabel={ySecondaryAxisLabel}
      aria-label={ariaLabel}
      hideXAxis={config?.hideXAxis}
      spatial={config?.spatial}
      gridScale={config?.gridScale}
      notice={notice}
      emptyState={emptyState}
      footer={
        hasThirdUnit ? (
          <Text tone="warn">Add explicit axes to plot 3+ units</Text>
        ) : undefined
      }
      plotReadout={plotReadout}
    >
      <GraphFetchers
        series={series.filter(
          (cfg) => !computedKeys.has(seriesKeyOf(cfg.source)),
        )}
        extraFetches={extraFetches}
        xFetch={xPinned ? undefined : xSource}
        windowSec={windowSec}
        onData={handleData}
        onXData={handleXData}
      />
    </Graph>
  );
}
