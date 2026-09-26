import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import {
  getSizeBucket,
  registerComponent,
  safeRandomUuid,
} from "@ksp-gonogo/core";
import type {
  DataKeyMeta,
  SeriesRange,
  SeriesTimeBasis,
} from "@ksp-gonogo/data";
import { isThresholdSubject, useDataSchema } from "@ksp-gonogo/data";
import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import type {
  ChartSeries,
  ChartSeriesData,
  ThresholdRule,
} from "@ksp-gonogo/ui";
import {
  BigReadout,
  ConfigForm,
  DataKeyPicker,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  LineChart,
  plotLayerExtent,
  ReadoutCaption,
  Select,
  Sparkline,
  useModalSaveBar,
  utXTickFormat,
} from "@ksp-gonogo/ui";
import {
  FramedDisplay,
  GhostButton,
  IconButton,
  NULL_DISPLAY,
  Panel,
  Section,
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
import { alignXY } from "./align";
import { GraphSeries } from "./GraphSeries";
import { paletteColor } from "./palette";
import type {
  ComputedSeries,
  GraphConfig,
  GraphSeriesConfig,
  GraphThresholdConfig,
  GraphVariant,
} from "./types";
import { TIME_AXIS } from "./types";

function withDefaults(raw: GraphSeriesConfig): GraphSeriesConfig {
  return { ...raw, type: raw.type ?? "line" };
}

function computeValueDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === max ? [min - 1, min + 1] : [min, max];
}

/** X domain for non-time graphs: the live X buffer plus every reference curve and contributed layer, so no curve is clipped off the edge before a sample arrives. */
function computeXDomain(
  liveXs: readonly number[],
  overlays: readonly ChartSeries[],
  layers: readonly PlotLayer[],
): [number, number] {
  const all = [...liveXs];
  for (const o of overlays) all.push(...o.data.x);
  for (const layer of layers) all.push(...plotLayerExtent(layer).xs);
  return computeValueDomain(all);
}

/**
 * X domain for a time graph: the span the plotted samples cover, read off the data because samples may be stamped in UT seconds or wall-clock milliseconds. `windowSec` sets the span only for a chart with no marks.
 *
 * A series carrying a reckoned run extends the right edge to `windowEndAt`, so the blank where a model declined stays visible; a purely measured series claims nothing past its last sample.
 */
function computeTimeDomain(
  series: readonly ChartSeries[],
  windowSec: number,
  reckonedWindowEnd?: number,
): [number, number] {
  const all: number[] = [];
  for (const s of series) all.push(...s.data.x);
  if (all.length === 0) {
    const now = Date.now();
    return [now - windowSec * 1000, now];
  }
  if (reckonedWindowEnd !== undefined) all.push(reckonedWindowEnd);
  return computeValueDomain(all);
}

function formatReadoutValue(value: number): string {
  if (!Number.isFinite(value)) return NULL_DISPLAY;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/** An axis tick on a known unit, written by the unit registry: the k/M suffixer would turn 2000 m/s into "2.0km/s", a different quantity. A string because SVG `<text>` cannot hold a `<Unit>` span. */
function unitTick(unit: string, magnitude: number): string {
  return writeQuantity(value(unit as never, magnitude), { decimals: 0 });
}

function formatNumericTick(value: number, unit?: string): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000) text = `${(value / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) text = `${(value / 1_000).toFixed(1)}k`;
  else if (Number.isInteger(value)) text = String(value);
  else text = value.toFixed(2);
  return unit ? `${text}${unit}` : text;
}

function resolveAxes(
  configs: GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
): Array<"primary" | "secondary"> {
  // An undefined axis must read as "auto", or the series lands on neither axis.
  const axisOf = (c: GraphSeriesConfig) => c.axis ?? "auto";
  if (configs.every((c) => axisOf(c) !== "auto")) {
    return configs.map((c) => c.axis as "primary" | "secondary");
  }
  const units = configs.map((c) => metaMap.get(c.key)?.unit ?? "raw");
  const seen: string[] = [];
  for (const u of units) {
    if (!seen.includes(u)) seen.push(u);
  }
  return configs.map((c) => {
    if (axisOf(c) !== "auto") return c.axis as "primary" | "secondary";
    const u = metaMap.get(c.key)?.unit ?? "raw";
    return seen.indexOf(u) === 0 ? "primary" : "secondary";
  });
}

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

interface GraphViewProps {
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

  const schema = useDataSchema("data");
  const metaMap = useMemo(() => {
    const map = new Map(schema.map((k) => [k.key, k]));
    for (const c of computedSeries ?? []) map.set(c.meta.key, c.meta);
    return map;
  }, [schema, computedSeries]);
  const xMeta = xIsTime || xPinned ? null : (metaMap.get(xKey) ?? null);

  /** The header names the plotted units, not the series, because units dedupe where names do not; with no known unit it stays "GRAPH". */
  const units = useMemo(() => {
    if (title !== undefined) return "";
    // Units on one axis join with "&", axes join with "x", through the same resolveAxes the plot uses.
    const axes = resolveAxes(series, metaMap);
    const byAxis: Record<"primary" | "secondary", string[]> = {
      primary: [],
      secondary: [],
    };
    series.forEach((cfg, i) => {
      const unit = metaMap.get(cfg.key)?.unit;
      if (!unit) return;
      const bucket = byAxis[axes[i]];
      if (!bucket.includes(unit)) bucket.push(unit);
    });
    const sides = [byAxis.primary, byAxis.secondary]
      .filter((u) => u.length > 0)
      .map((u) => u.join(" & "));
    if (sides.length === 0) return "";
    const against = xIsTime ? "" : `${xMeta?.unit ?? xMeta?.label ?? xKey} x `;
    return `${against}${sides.join(" x ")}`;
  }, [title, series, metaMap, xIsTime, xMeta, xKey]);

  /** The series names, as the header's tooltip. */
  const fullTitle = useMemo(
    () =>
      title !== undefined
        ? undefined
        : series
            .map((cfg) => cfg.label ?? metaMap.get(cfg.key)?.label ?? cfg.key)
            .join(", ") || undefined,
    [title, series, metaMap],
  );

  const requestedVariant: GraphVariant = config?.variant ?? "auto";
  const hasReferenceCurves = !!referenceCurves && referenceCurves.length > 0;
  const sizeBucket = getSizeBucket(w, h);
  const canReadout =
    series.length === 1 && !hasReferenceCurves && layers.length === 0;
  // At `small` the chart's axes and legend squash enough that a number and sparkline read better.
  const autoShouldReadout = sizeBucket === "tiny" || sizeBucket === "small";
  const resolvedVariant: "chart" | "readout" = canReadout
    ? requestedVariant === "readout"
      ? "readout"
      : requestedVariant === "auto" && autoShouldReadout
        ? "readout"
        : "chart"
    : "chart";

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

  const axes = resolveAxes(series, metaMap);
  const hasThirdUnit = (() => {
    const units = series.map((c) => metaMap.get(c.key)?.unit ?? "raw");
    return new Set(units).size > 2;
  })();

  const liveSeries: ChartSeries[] = series.map((cfg, i) => {
    const meta = metaMap.get(cfg.key);
    const raw = seriesData.get(cfg.key) ?? { t: [], v: [] };
    // Only a time axis keeps spans, reckoned runs and bridges: on a re-paired parametric axis they would name the wrong part of the curve.
    const baseData = xIsTime
      ? {
          x: raw.t,
          y: raw.v as number[],
          breaks: raw.breaks,
          spans: raw.spans,
          reckoned: raw.reckoned,
          bridges: raw.bridges,
        }
      : alignXY(raw as SeriesRange<number>, xData);

    let data: ChartSeriesData = baseData;
    if (cfg.type === "band" && cfg.keyHigh) {
      const rawHigh = seriesData.get(cfg.keyHigh) ?? { t: [], v: [] };
      const highData = xIsTime
        ? { x: rawHigh.t, y: rawHigh.v as number[] }
        : alignXY(rawHigh as SeriesRange<number>, xData);
      // Paired by index; LineChart's band builder clamps mismatched lengths to the shortest.
      data = {
        x: baseData.x,
        y: baseData.y,
        y2: highData.y,
        breaks: baseData.breaks,
      };
      // A band carries no spans or reckoned runs: its polygon has no stroke to dash.
    }

    return {
      id: cfg.id,
      label: cfg.label ?? meta?.label ?? cfg.key,
      axis: axes[i],
      color: cfg.color ?? paletteColor(i),
      type: cfg.type ?? "line",
      data,
    };
  });

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

  const xDomain: [number, number] = xPinned
    ? (config?.xDomain as [number, number])
    : xIsTime
      ? computeTimeDomain(liveSeries, windowSec, reckonedWindowEnd)
      : computeXDomain(xData.v as number[], overlaySeries, layers);

  // The clock the samples are stamped against, as the fetcher declared it; the first series with samples decides.
  const timeBasis: SeriesTimeBasis =
    series
      .map((cfg) => seriesData.get(cfg.key))
      .find((range) => range !== undefined && range.t.length > 0)?.basis ??
    "wall-ms";

  const xTickFormat = xIsTime
    ? timeBasis === "ut-seconds"
      ? utXTickFormat
      : undefined
    : xPinned && config?.xUnit
      ? (v: number) => unitTick(config.xUnit as string, v)
      : (v: number) => formatNumericTick(v, xMeta?.unit);

  const yTickFormat = config?.yUnit
    ? (v: number) => unitTick(config.yUnit as string, v)
    : undefined;

  if (resolvedVariant === "readout") {
    const cfg = series[0];
    const meta = metaMap.get(cfg.key);
    const raw = seriesData.get(cfg.key) ?? { t: [], v: [] };
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
                {latest !== undefined
                  ? formatReadoutValue(latest)
                  : NULL_DISPLAY}
                {unit && <ReadoutCaption>{unit}</ReadoutCaption>}
              </BigReadout>
              <div style={SPARK_SLOT}>
                {size && (
                  <Sparkline
                    values={sparkValues}
                    width={size.w}
                    height={Math.min(
                      80,
                      Math.max(24, Math.floor(size.h * 0.35)),
                    )}
                    color={color}
                    ariaLabel={`${seriesLabel} trend`}
                  />
                )}
              </div>
            </div>
            {!computedKeys.has(cfg.key) && (
              <GraphSeries
                key={cfg.id}
                dataKey={cfg.key}
                windowSec={windowSec}
                onData={handleData}
              />
            )}
          </Section>
        }
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
      {series
        .filter((cfg) => !computedKeys.has(cfg.key))
        .map((cfg) => (
          <GraphSeries
            key={cfg.id}
            dataKey={cfg.key}
            windowSec={windowSec}
            onData={handleData}
          />
        ))}
      {extraFetchKeys.map((k) => (
        <GraphSeries
          key={`extra-${k}`}
          dataKey={k}
          windowSec={windowSec}
          onData={handleData}
        />
      ))}
      {!xIsTime && !xPinned && (
        <GraphSeries
          key={`x-${xKey}`}
          dataKey={xKey}
          windowSec={windowSec}
          onData={handleXData}
        />
      )}
    </>
  );

  if (chrome === "bare") return chartBody;

  return (
    <Panel
      panelTitle={
        title !== undefined ? (
          title
        ) : units ? (
          <>
            GRAPH{" "}
            <span title={fullTitle} style={GRAPH_UNITS}>
              {units}
            </span>
          </>
        ) : (
          "GRAPH"
        )
      }
      panelAside={headerActions}
      sections={<Section fill>{chartBody}</Section>}
    />
  );
}

function GraphComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<GraphConfig>>) {
  return <GraphView config={config} w={w} h={h} />;
}

function GraphConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<GraphConfig>>) {
  const [seriesList, setSeriesList] = useState<GraphSeriesConfig[]>(
    config?.series ?? [],
  );
  const [windowSec, setWindowSec] = useState(String(config?.windowSec ?? 300));
  const [xKey, setXKey] = useState<string>(config?.xKey ?? TIME_AXIS);
  const [yMinPrimary, setYMinPrimary] = useState(
    config?.yDomainPrimary ? String(config.yDomainPrimary[0]) : "",
  );
  const [yMaxPrimary, setYMaxPrimary] = useState(
    config?.yDomainPrimary ? String(config.yDomainPrimary[1]) : "",
  );
  const [yMinSecondary, setYMinSecondary] = useState(
    config?.yDomainSecondary ? String(config.yDomainSecondary[0]) : "",
  );
  const [yMaxSecondary, setYMaxSecondary] = useState(
    config?.yDomainSecondary ? String(config.yDomainSecondary[1]) : "",
  );
  const [yScalePrimary, setYScalePrimary] = useState(
    config?.yScalePrimary ?? "linear",
  );
  const [yScaleSecondary, setYScaleSecondary] = useState(
    config?.yScaleSecondary ?? "linear",
  );
  const [thresholds, setThresholds] = useState<GraphThresholdConfig[]>(
    config?.thresholds ?? [],
  );
  const [variant, setVariant] = useState<GraphVariant>(
    config?.variant ?? "auto",
  );

  const schema = useDataSchema("data");
  // A graph axis orders its values, so it admits the same keys a threshold does.
  const numericKeys = schema.filter(isThresholdSubject);
  const xKeyOptions = [
    { key: TIME_AXIS, label: "Time", group: "Axis" },
    ...numericKeys,
  ];

  const addSeries = () => {
    setSeriesList((prev) => [
      ...prev,
      { id: safeRandomUuid(), key: "", type: "line", axis: "auto" },
    ]);
  };

  const updateSeries = (id: string, patch: Partial<GraphSeriesConfig>) => {
    setSeriesList((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };

  const removeSeries = (id: string) => {
    setSeriesList((prev) => prev.filter((s) => s.id !== id));
  };

  const addThreshold = () => {
    setThresholds((prev) => [
      ...prev,
      {
        id: safeRandomUuid(),
        value: 0,
        axis: "primary",
        label: "",
        dashed: true,
      },
    ]);
  };

  const updateThreshold = (
    id: string,
    patch: Partial<GraphThresholdConfig>,
  ) => {
    setThresholds((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  };

  const removeThreshold = (id: string) => {
    setThresholds((prev) => prev.filter((t) => t.id !== id));
  };

  const candidate = useMemo<GraphConfig>(
    () => ({
      ...config,
      series: seriesList.filter(
        (s) => s.key !== "" && (s.type !== "band" || (s.keyHigh ?? "") !== ""),
      ),
      windowSec: Math.max(10, Number.parseInt(windowSec, 10) || 300),
      xKey,
      yDomainPrimary: parseDomain(yMinPrimary, yMaxPrimary),
      yDomainSecondary: parseDomain(yMinSecondary, yMaxSecondary),
      yScalePrimary,
      yScaleSecondary,
      thresholds: thresholds.filter((t) => Number.isFinite(t.value)),
      variant,
    }),
    [
      config,
      seriesList,
      windowSec,
      xKey,
      yMinPrimary,
      yMaxPrimary,
      yMinSecondary,
      yMaxSecondary,
      yScalePrimary,
      yScaleSecondary,
      thresholds,
      variant,
    ],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  const seriesCount = seriesList.filter((s) => s.key !== "").length;
  const variantHint =
    variant === "readout" && seriesCount !== 1
      ? "Readout requires exactly one series, falls back to chart until configured."
      : variant === "auto"
        ? "Shows the latest number + sparkline when the widget is tiny and a single series is configured. Otherwise renders the chart."
        : undefined;

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="graph-variant">Display</FieldLabel>
        <Select
          id="graph-variant"
          value={variant}
          onChange={(e) => setVariant(e.target.value as GraphVariant)}
        >
          <option value="auto">Auto (chart, readout when tiny)</option>
          <option value="chart">Chart</option>
          <option value="readout">Readout (number + sparkline)</option>
        </Select>
        {variantHint && <FieldHint>{variantHint}</FieldHint>}
      </Field>
      <Field>
        <FieldLabel>X axis</FieldLabel>
        <DataKeyPicker
          keys={xKeyOptions}
          value={xKey}
          onChange={(k) => setXKey(k ?? TIME_AXIS)}
          placeholder="Pick an X-axis key..."
        />
      </Field>
      <Field>
        <FieldLabel>Series</FieldLabel>
        {seriesList.map((s) => (
          <div key={s.id} style={SERIES_GROUP}>
            <div style={SERIES_ROW}>
              <DataKeyPicker
                keys={numericKeys}
                value={s.key || null}
                onChange={(k) => updateSeries(s.id, { key: k ?? "" })}
                placeholder={
                  s.type === "band" ? "Pick lower bound..." : "Pick a key..."
                }
                clearable
              />
              <Select
                value={s.type ?? "line"}
                onChange={(e) =>
                  updateSeries(s.id, {
                    type: e.target.value as GraphSeriesConfig["type"],
                  })
                }
              >
                <option value="line">Line</option>
                <option value="step">Step</option>
                <option value="scatter">Scatter</option>
                <option value="band">Band</option>
              </Select>
              <Select
                value={s.axis}
                onChange={(e) =>
                  updateSeries(s.id, {
                    axis: e.target.value as GraphSeriesConfig["axis"],
                  })
                }
              >
                <option value="auto">Auto axis</option>
                <option value="primary">Primary (left)</option>
                <option value="secondary">Secondary (right)</option>
              </Select>
              <IconButton
                type="button"
                onClick={() => removeSeries(s.id)}
                style={REMOVE_BUTTON}
              >
                ×
              </IconButton>
            </div>
            {s.type === "band" && (
              <div style={SERIES_ROW}>
                <DataKeyPicker
                  keys={numericKeys}
                  value={s.keyHigh ?? null}
                  onChange={(k) => updateSeries(s.id, { keyHigh: k ?? "" })}
                  placeholder="Pick upper bound..."
                  clearable
                />
              </div>
            )}
          </div>
        ))}
        <GhostButton type="button" onClick={addSeries} style={ADD_BUTTON}>
          + Add series
        </GhostButton>
      </Field>
      <Field>
        <FieldLabel htmlFor="graph-window">Window (seconds)</FieldLabel>
        <Input
          id="graph-window"
          type="number"
          min={10}
          max={3600}
          value={windowSec}
          onChange={(e) => setWindowSec(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Primary Y range (leave blank for auto)</FieldLabel>
        <div style={DOMAIN_ROW}>
          <Input
            type="number"
            placeholder="min"
            value={yMinPrimary}
            onChange={(e) => setYMinPrimary(e.target.value)}
          />
          <Input
            type="number"
            placeholder="max"
            value={yMaxPrimary}
            onChange={(e) => setYMaxPrimary(e.target.value)}
          />
          <Select
            value={yScalePrimary}
            onChange={(e) =>
              setYScalePrimary(e.target.value as "linear" | "log")
            }
          >
            <option value="linear">Linear</option>
            <option value="log">Log10</option>
          </Select>
        </div>
      </Field>
      <Field>
        <FieldLabel>Secondary Y range (leave blank for auto)</FieldLabel>
        <div style={DOMAIN_ROW}>
          <Input
            type="number"
            placeholder="min"
            value={yMinSecondary}
            onChange={(e) => setYMinSecondary(e.target.value)}
          />
          <Input
            type="number"
            placeholder="max"
            value={yMaxSecondary}
            onChange={(e) => setYMaxSecondary(e.target.value)}
          />
          <Select
            value={yScaleSecondary}
            onChange={(e) =>
              setYScaleSecondary(e.target.value as "linear" | "log")
            }
          >
            <option value="linear">Linear</option>
            <option value="log">Log10</option>
          </Select>
        </div>
      </Field>
      <Field>
        <FieldLabel>Threshold lines</FieldLabel>
        {thresholds.map((t) => (
          <div key={t.id} style={SERIES_ROW}>
            <Input
              type="text"
              placeholder="Label"
              value={t.label ?? ""}
              onChange={(e) => updateThreshold(t.id, { label: e.target.value })}
            />
            <Input
              type="number"
              placeholder="value"
              value={Number.isFinite(t.value) ? String(t.value) : ""}
              onChange={(e) =>
                updateThreshold(t.id, {
                  value: Number.parseFloat(e.target.value),
                })
              }
            />
            <Select
              value={t.axis}
              onChange={(e) =>
                updateThreshold(t.id, {
                  axis: e.target.value as "primary" | "secondary",
                })
              }
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </Select>
            <IconButton
              type="button"
              onClick={() => removeThreshold(t.id)}
              style={REMOVE_BUTTON}
            >
              ×
            </IconButton>
          </div>
        ))}
        <GhostButton type="button" onClick={addThreshold} style={ADD_BUTTON}>
          + Add threshold
        </GhostButton>
      </Field>
    </ConfigForm>
  );
}

function parseDomain(
  minStr: string,
  maxStr: string,
): [number, number] | undefined {
  if (minStr.trim() === "" || maxStr.trim() === "") return undefined;
  const min = Number(minStr);
  const max = Number(maxStr);
  if (Number.isNaN(min) || Number.isNaN(max) || min >= max) return undefined;
  return [min, max];
}

// A frame, not `floatingHeader`: LineChart draws its legend top-left inside the plot, where a floating title would land.
const CHART_FRAME: CSSProperties = { flex: 1, minHeight: 0 };

const CHART_AREA: CSSProperties = {
  flex: 1,
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};

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

const SERIES_ROW: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
  alignItems: "center",
  marginBottom: "var(--gap-related-compact)",
};

const SERIES_GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  marginBottom: "var(--gap-config-group)",
};

const DOMAIN_ROW: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
};

const ADD_BUTTON: CSSProperties = {
  width: "100%",
  borderStyle: "dashed",
  borderColor: "var(--color-text-faint)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-compact)",
  fontWeight: 400,
  letterSpacing: "normal",
  textTransform: "none",
  padding: "var(--inset-control)",
  marginTop: "var(--gap-actions)",
};

const REMOVE_BUTTON: CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-lg)",
  lineHeight: "var(--line-height-flush)",
  padding: "var(--inset-glyph)",
  flexShrink: 0,
};

// Unit symbols are case-sensitive, so they opt out of the header's uppercase.
const GRAPH_UNITS: CSSProperties = { textTransform: "none" };

registerComponent<GraphConfig>({
  id: "graph",
  name: "Graph",
  description: "Line chart of one or more live telemetry series over time.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  // The plot area collapses below about 240px tall.
  mobileHeight: 280,
  component: GraphComponent,
  configComponent: GraphConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: { series: [], windowSec: 300 },
  actions: [],
  pushable: true,
});

export type {
  ComputedSeries,
  GraphConfig,
  GraphSeriesConfig,
  GraphThresholdConfig,
} from "./types";
export { TIME_AXIS } from "./types";
export { GraphComponent };
