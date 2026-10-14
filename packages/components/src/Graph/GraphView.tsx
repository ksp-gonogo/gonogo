import type {
  DataKeyMeta,
  SeriesRange,
  SeriesTimeBasis,
} from "@ksp-gonogo/data";
import { plotColumnsOf, useTopicFieldCatalog } from "@ksp-gonogo/data";
import {
  magnitudeOf,
  type PlotLayer,
  seriesKeyOf,
} from "@ksp-gonogo/sitrep-sdk";
import type { ChartSeries, ThresholdRule } from "@ksp-gonogo/ui";
import { LineChart, utXTickFormat } from "@ksp-gonogo/ui";
import {
  Box,
  FramedDisplay,
  GraphNotice,
  getSizeBucket,
  Panel,
  placeGraphNotice,
  resolveCurrency,
  Section,
  speakQuantity,
  Text,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
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
import { axisTitle, yAxisTitle } from "./axisTitles";
import { GraphFetchers } from "./GraphFetchers";
import { GraphReadout } from "./GraphReadout";
import {
  computeFullTitle,
  computeUnitsLabel,
  resolvePanelTitle,
} from "./header";
import { buildLiveSeries } from "./liveSeries";
import { formatNumericTick, unitTick, writeThreeFigures } from "./ticks";
import type {
  ComputedSeries,
  GraphThreshold,
  GraphVariant,
  GraphViewConfig,
} from "./types";

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

/**
 * A threshold as the chart draws it: placed at the figure its quantity
 * resolves to, which is the model's where the reading carries one, and labelled
 * with that figure after the caller's own words. A line with no finite figure
 * is not drawn.
 */
function thresholdRuleOf(
  line: GraphThreshold,
  index: number,
): ThresholdRule | null {
  const { shown } = resolveCurrency(line.value, { drawsReckoning: true });
  // The one number the chart's scale needs, taken where the line is placed.
  const at = magnitudeOf(shown);
  if (at === null) return null;
  return {
    id: line.id ?? `threshold-${index}`,
    value: at,
    ...(line.kind === "limit"
      ? { kind: line.kind, bad: line.bad }
      : { kind: line.kind }),
    axis: line.axis,
    // Drawn with the unit's symbol like every other figure on the chart, and read aloud with its word.
    label: [line.label, shown ? writeThreeFigures(shown) : undefined]
      .filter(Boolean)
      .join(": "),
    spokenLabel: [line.label, speakQuantity(shown)].filter(Boolean).join(": "),
    reading: "state" in line.value ? line.value : undefined,
  };
}

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

/** The newest sample of the first plotted series, with the figure each reference curve has at its x. */
export interface PresentPoint {
  x: number;
  y: number;
  /** Reference curves read at `x`, by curve id; a curve that does not reach `x` is left out. */
  references: Readonly<Record<string, number>>;
}

/** The value of a sampled curve at `x` by straight lines between samples, or nothing outside the curve. */
function readCurveAt(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
): number | undefined {
  for (let i = 1; i < xs.length; i++) {
    const [x0, x1] = [xs[i - 1], xs[i]];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && x1 !== x0) {
      return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - x0)) / (x1 - x0);
    }
  }
  return undefined;
}

/** The space a readout is offered, so it can answer with a form that fits: a column has all it needs, a card on the plot has the plot's. */
export interface ReadoutRoom {
  width: number;
  height: number;
  /** Where the first plotted series stands now (its newest sample) and what each reference curve reads there, in the plot's own numbers. Absent on a time axis or before a sample arrives. */
  present?: PresentPoint;
  /** Figures set beside their labels have no clear corner, so they should be stacked under them. */
  compact: boolean;
  /** Stacked figures have no clear corner either, so they should be drawn as small as they can be. */
  tight: boolean;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bind when the variant flips, the readout renders no area
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setArea({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolvedVariant]);

  const [asideSize, setAsideSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [asideEl, setAsideEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!asideEl) return;
    const ro = new ResizeObserver(() =>
      setAsideSize({
        w: asideEl.offsetWidth + ASIDE_CHROME_PX,
        h: asideEl.offsetHeight + ASIDE_CHROME_PX,
      }),
    );
    ro.observe(asideEl);
    return () => ro.disconnect();
  }, [asideEl]);

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

  const thresholdRules = useMemo(
    () =>
      (thresholds ?? [])
        .map(thresholdRuleOf)
        .filter((rule): rule is ThresholdRule => rule !== null),
    [thresholds],
  );

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
          readBetween: true,
          data: { x: curve.xs, y: curve.ys },
        }))
      : [];

  const chartSeries: ChartSeries[] = [...liveSeries, ...overlaySeries];

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
    return computeXDomain(xData.v as number[], overlaySeries, layers);
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
    if (xPinned && config?.xUnit) {
      const unit = config.xUnit;
      return (
        v: number,
        _domain: readonly [number, number],
        ticks?: readonly number[],
      ) => unitTick(unit, v, ticks);
    }
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

  const yTickFormat = config?.yUnit
    ? (v: number, ticks?: readonly number[]) =>
        unitTick(config.yUnit as string, v, ticks)
    : undefined;

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
        containerRef={containerRef}
        needsFetch={!computedKeys.has(key)}
        windowSec={windowSec}
        onData={handleData}
      />
    );
  }

  const plotIsEmpty =
    series.length === 0 && overlaySeries.length === 0 && layers.length === 0;
  const plotHasData =
    layers.length > 0 || chartSeries.some((cs) => (cs.data.x?.length ?? 0) > 0);
  const notices: ReactNode[] = [];
  if (plotIsEmpty) notices.push(emptyState);
  if (notice) notices.push(notice);
  // Until the first measurement an empty plot is assumed roomy, so a frame that will end up alone in its panel does not start out with a notice beside it.
  const noticePlacement = area
    ? placeGraphNotice({ width: area.w, height: area.h, plotHasData })
    : plotHasData
      ? "inline"
      : "center";

  const noticeNode = (
    <GraphNotice placement={noticePlacement}>
      {notices.map((n, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole each render and never reordered
        <div key={i}>{n}</div>
      ))}
    </GraphNotice>
  );

  const present = ((): PresentPoint | undefined => {
    if (xIsTime) return undefined;
    const lead = liveSeries.find(
      (s) => s.type !== "band" && s.data.x.length > 0,
    );
    if (!lead) return undefined;
    let last = lead.data.x.length - 1;
    while (
      last >= 0 &&
      !(
        Number.isFinite(lead.data.x[last]) && Number.isFinite(lead.data.y[last])
      )
    ) {
      last -= 1;
    }
    if (last < 0) return undefined;
    const x = lead.data.x[last];
    const references: Record<string, number> = {};
    for (const curve of referenceCurves ?? []) {
      const at = readCurveAt(curve.xs, curve.ys, x);
      if (at !== undefined) references[curve.id] = at;
    }
    return { x, y: lead.data.y[last], references };
  })();
  // A readout that answers with nothing for the present state has nothing to place.
  const columnReadout =
    typeof plotReadout === "function"
      ? plotReadout({
          width: Number.POSITIVE_INFINITY,
          height: Number.POSITIVE_INFINITY,
          present,
          compact: false,
          tight: false,
        })
      : plotReadout;
  const hasReadout = columnReadout !== undefined && columnReadout !== null;
  // Beside the plot only where the plot keeps a usable width and the column fits the height; until the column has been measured it is assumed a typical width.
  const readoutBeside =
    hasReadout &&
    area !== null &&
    area.w - (asideSize?.w ?? ASIDE_GUESS_PX) >= ASIDE_PLOT_KEEPS_PX &&
    area.h >= (asideSize?.h ?? 0);

  const chartBody = (
    <div
      ref={areaRef}
      style={{
        ...CHART_BODY,
        flexDirection: noticePlacement === "beside" ? "row" : "column",
      }}
    >
      <FramedDisplay
        style={CHART_FRAME}
        footer={
          hasThirdUnit ? (
            <Text tone="warn">Add explicit axes to plot 3+ units</Text>
          ) : undefined
        }
      >
        <div ref={containerRef} style={CHART_AREA}>
          {size && (
            <LineChart
              series={chartSeries}
              xDomain={xDomain}
              xTickFormat={xTickFormat}
              xReadFormat={xReadFormat}
              yDomainPrimary={config?.yDomainPrimary}
              yDomainSecondary={config?.yDomainSecondary}
              yScalePrimary={config?.yScalePrimary}
              yScaleSecondary={config?.yScaleSecondary}
              yTickFormat={yTickFormat}
              thresholds={thresholdRules}
              layers={layers}
              hideXAxis={config?.hideXAxis}
              spatial={config?.spatial}
              gridScale={config?.gridScale}
              aria-label={ariaLabel}
              crosshair={!config?.hideXAxis}
              xKind={xIsTime ? "time" : "value"}
              xAxisLabel={config?.spatial ? undefined : xAxisTitle}
              yAxisLabel={config?.spatial ? undefined : yAxisLabel}
              ySecondaryAxisLabel={
                config?.spatial ? undefined : ySecondaryAxisLabel
              }
              card={
                hasReadout && !readoutBeside
                  ? typeof plotReadout === "function"
                    ? (room) =>
                        plotReadout({
                          width: room.width,
                          height: room.height,
                          present,
                          compact: room.form > 0,
                          tight: room.form > 1,
                        })
                    : plotReadout
                  : undefined
              }
              cardForms={typeof plotReadout === "function" ? 3 : 1}
              width={size.w}
              height={size.h}
            />
          )}
          {/* Inside the frame, so a notice laid over an empty plot leaves the frame the body's only content. */}
          {notices.length > 0 && noticePlacement === "center" && noticeNode}
        </div>
        {readoutBeside && (
          <Box pad="surface" style={PLOT_ASIDE}>
            <div ref={setAsideEl} data-plot-aside="">
              {columnReadout}
            </div>
          </Box>
        )}
        {/* Draws nothing, so it rides inside the frame and leaves it the chart's only content when there's no notice beside it. */}
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
      </FramedDisplay>
      {notices.length > 0 && noticePlacement !== "center" && noticeNode}
    </div>
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

/** A column beside the plot is assumed this wide until it has been measured. */
const ASIDE_GUESS_PX = 180;
/** The column's padding and border around the readout it holds, which the measured readout does not include. */
const ASIDE_CHROME_PX = 24;
/** What the plot must keep, its axes included, once the column is taken. */
const ASIDE_PLOT_KEEPS_PX = 300;

const CHART_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};

const CHART_FRAME: CSSProperties = { flex: 1, minHeight: 0, minWidth: 0 };

const PLOT_ASIDE: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  borderLeft: "1px solid var(--color-border-subtle)",
};

const CHART_AREA: CSSProperties = {
  flex: 1,
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};
