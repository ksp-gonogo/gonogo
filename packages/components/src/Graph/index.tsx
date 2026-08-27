import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import {
  getSizeBucket,
  registerComponent,
  safeRandomUuid,
  useContributions,
} from "@ksp-gonogo/core";
import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
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
} from "@ksp-gonogo/ui";
import {
  FramedDisplay,
  GhostButton,
  IconButton,
  NULL_DISPLAY,
  Panel,
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

/**
 * X domain for non-time graphs. Combines the live X buffer with any reference
 * curves so an empty / partial trace doesn't squash a wide reference curve
 * into a sliver, and so a reference curve always defines a sensible plot
 * window even before the first telemetry sample arrives.
 */
function computeXDomain(
  liveXs: readonly number[],
  overlays: readonly ChartSeries[],
  layers: readonly PlotLayer[],
): [number, number] {
  const all = [...liveXs];
  for (const o of overlays) all.push(...o.data.x);
  // Contributed layers join the X domain on the same terms a reference curve
  // does, for the same reason: a plot scaled only to its own marks clips a
  // guest's curve off the edge and shows nothing to say it had.
  for (const layer of layers) all.push(...plotLayerExtent(layer).xs);
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

/**
 * An axis tick on a KNOWN unit, written by the unit registry rather than by the
 * k/M suffixer below.
 *
 * The suffixer concatenates: 2000 on an `m/s` axis came out "2.0km/s", which
 * reads as kilometres per second and is a different quantity. Its own prefix
 * and a unit symbol cannot both be in one string, so where the axis knows its
 * unit token, the ladder does the work and the axis says "2000 m/s".
 *
 * `writeQuantity` rather than `<Unit>` for the reason every SVG readout in this
 * repo takes that route: a `<text>` element cannot contain a `<span>`. The
 * symbol and the ladder still come from the registry.
 */
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

// ── Axis resolution ───────────────────────────────────────────────────────────

function resolveAxes(
  configs: GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
): Array<"primary" | "secondary"> {
  // A missing axis field means "auto": the config form writes "auto"
  // explicitly, but programmatic / imported / older persisted configs omit
  // the field entirely. Passing the raw undefined through put the series on
  // NEITHER axis: the domain computation saw no data (fell back to [0,1])
  // while the path builder still plotted real values against that
  // degenerate scale, blasting the curves off-canvas.
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

// ── GraphView ────────────────────────────────────────────────────────────────
//
// The shared rendering engine. Takes a resolved GraphConfig and optional
// reference curves (pre-computed by the caller: typically a domain-specific
// preset widget like OrbitalAscent that wants to overlay an ideal curve on top
// of live telemetry). Curves are injected as synthetic ChartSeries entries
// alongside the live ones; the X domain expands to cover them.

/**
 * A pre-computed reference curve to overlay on the chart. The caller is
 * responsible for sampling whatever function it wants to display (e.g.
 * `circularOrbitVelocity` over an altitude range) and producing the parallel
 * `xs` / `ys` arrays. No data subscription happens for these, they are
 * static for the lifetime of the prop.
 */
export interface ReferenceCurve {
  /** Stable ID; must not collide with any series ID. */
  id: string;
  /** Legend label / debug name. */
  label: string;
  xs: number[];
  ys: number[];
  /** CSS color. Defaults to a dim accent if omitted. */
  color?: string;
  /** Which Y axis the curve belongs to. Defaults to "primary". */
  axis?: "primary" | "secondary";
}

interface GraphViewProps {
  config: GraphConfig | undefined;
  referenceCurves?: ReadonlyArray<ReferenceCurve>;
  /**
   * Override the panel header. Omit it and the header names what is actually
   * plotted, e.g. "GRAPH VELOCITY x ALTITUDE & APOAPSIS". A widget built ON
   * GraphView (EscapeProfile, AtmosphereProfile) plots one fixed thing and
   * passes its own name instead.
   */
  title?: string;
  /** Replaces the empty-state copy when no series are configured. */
  emptyState?: string;
  /**
   * Right-aligned slot in the panel header, beside the title. Forwarded
   * straight to `panelAside`, so it takes whatever that slot takes: a state
   * chip, a small control, an `AugmentSlot`.
   *
   * Not the place for a stream-status badge any more. The panel renders one
   * itself from the status the host derived across the whole widget's
   * `dataRequirements`, which is both less wiring and more accurate than a
   * hand-picked representative key; a badge passed in here would sit beside
   * that one rather than instead of it.
   */
  headerActions?: ReactNode;
  /**
   * Plot layers this widget contributes to ITSELF, merged with whatever else
   * has been contributed to `${componentId}.plot-layers`. A widget's own marks
   * take the same route a guest's do, so there is no geometry a first-party
   * plot can reach that a contributor cannot: see `plot-layers` in the SDK.
   */
  layers?: readonly PlotLayer[];
  /**
   * Drop the panel chrome and render the framed chart alone, for a plot
   * composed inside another widget's own layout. The title and header actions
   * are then that widget's business rather than this one's.
   */
  chrome?: "panel" | "bare";
  /** Names what the chart IS, before its layers add their own clauses. Only
   *  consulted while `chrome` is `"bare"`; a panel names itself. */
  ariaLabel?: string;
  /** Current widget grid size: used to resolve the `"auto"` display variant. */
  w?: number;
  h?: number;
}

export function GraphView({
  config,
  referenceCurves,
  title,
  emptyState = "Configure series to begin graphing.",
  headerActions,
  layers: ownLayers,
  chrome = "panel",
  ariaLabel,
  w,
  h,
}: GraphViewProps) {
  const series = useMemo(
    () => (config?.series ?? []).map(withDefaults),
    [config?.series],
  );
  // Contributed layers, from the framework-universal `plot-layers` segment,
  // completed to `${componentId}.plot-layers` from the mounting widget's own
  // meta. Merged with the widget's own so the paint order in `PlotLayers` is
  // the only thing that separates a host mark from a guest's.
  const contributed = useContributions("plot-layers");
  const layers = useMemo(
    () => [...(ownLayers ?? []), ...contributed],
    [ownLayers, contributed],
  );

  const windowSec = config?.windowSec ?? 300;
  const xKey = config?.xKey ?? TIME_AXIS;
  // A pinned X domain means the axis is fed by NOTHING: no data key, no wall
  // clock, just the numbers the curves and layers are stated in.
  const xPinned = config?.xDomain !== undefined;
  const xIsTime = !xPinned && xKey === TIME_AXIS;

  const schema = useDataSchema("data");
  // Schema is ~150 entries today; rebuilding the lookup map every render
  // (Graph re-renders on each child's onData callback ≈ 4 Hz) was
  // ~600 hash inserts/sec for no reason. Memo against the schema array
  // identity (stable thanks to useDataSchema's own memo).
  const metaMap = useMemo(
    () => new Map(schema.map((k) => [k.key, k])),
    [schema],
  );
  const xMeta = xIsTime || xPinned ? null : (metaMap.get(xKey) ?? null);

  /**
   * A header that names what the chart MEASURES: "GRAPH m x m/s". "GRAPH"
   * alone made every graph on a dashboard look identical until you read its
   * legend.
   *
   * Units rather than series names, and this is the reason: units dedupe where
   * names do not. Altitude plotted against apoapsis is two names but one unit,
   * so the title says "m" once and is telling the truth about the axis; naming
   * both would spend the header restating the legend. It also degrades well,
   * since a graph gains series far more often than it gains units.
   *
   * A series whose key carries no unit in the schema contributes nothing, and
   * if NOTHING carries one the header stays "GRAPH" and the legend does the
   * work. (Several real keys are in this position: `v.horizontalVelocity` has
   * no schema entry, so a chart of it alone is titled "GRAPH".)
   */
  const units = useMemo(() => {
    if (title !== undefined) return "";
    // Units belong to AXES, not to the series list. Two units on one axis are
    // two things measured against the same scale, so they read "m & m/s"; two
    // AXES are two scales plotted against each other, so they read "m x m/s".
    // Flattening both into one separator lost that distinction, which is the
    // whole information the header carries. Uses the same resolveAxes the plot
    // does, so the header cannot describe a different arrangement than the one
    // drawn (a series left on "auto" is assigned by unit, not by position).
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

  /** The series themselves, as a tooltip: the header says what is measured,
   *  this says which readings are on the chart. */
  const fullTitle = useMemo(
    () =>
      title !== undefined
        ? undefined
        : series
            .map((cfg) => cfg.label ?? metaMap.get(cfg.key)?.label ?? cfg.key)
            .join(", ") || undefined,
    [title, series, metaMap],
  );

  // Resolve variant up-front so the ResizeObserver below knows which element
  // to observe: chart and readout render different children behind the same
  // ref, so we re-bind the observer when the variant flips.
  const requestedVariant: GraphVariant = config?.variant ?? "auto";
  const hasReferenceCurves = !!referenceCurves && referenceCurves.length > 0;
  const sizeBucket = getSizeBucket(w, h);
  const canReadout =
    series.length === 1 && !hasReferenceCurves && layers.length === 0;
  // Auto downgrades to readout for both `tiny` and `small`, at "small" the
  // chart axes/legend get squashed enough that a number + sparkline reads
  // better. Mobile half-width cells land in `tiny`, mobile full-width and
  // desktop-shrunk widgets land in `small`.
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

  // Collected numeric series data from child GraphSeries components.
  // Contains Y-series data keyed by their data-key. When xKey is a data key
  // (not time), xData is fetched in parallel and held separately so we can
  // re-pair samples at render time.
  const [seriesData, setSeriesData] = useState<
    Map<string, SeriesRange<number>>
  >(new Map());
  const [xData, setXData] = useState<SeriesRange<number>>({ t: [], v: [] });

  // Clear stale X buffer when the X key changes; otherwise the first frame
  // after reconfigure pairs new Y against the previous key's values.
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
    const baseData = xIsTime
      ? { x: raw.t, y: raw.v as number[] }
      : alignXY(raw as SeriesRange<number>, xData);

    // Band series pair `key` (lower bound) with `keyHigh` (upper bound).
    // The upper-bound samples are fetched in parallel via a second
    // GraphSeries below, then paired here against the same X values.
    let data: ChartSeriesData = baseData;
    if (cfg.type === "band" && cfg.keyHigh) {
      const rawHigh = seriesData.get(cfg.keyHigh) ?? { t: [], v: [] };
      const highData = xIsTime
        ? { x: rawHigh.t, y: rawHigh.v as number[] }
        : alignXY(rawHigh as SeriesRange<number>, xData);
      // Pair by index, both are clipped to the shared window already, and
      // for time-X both fetchers share the same windowSec so lengths align.
      // Mismatched lengths fall through to LineChart's safe band builder
      // which clamps to the shortest array.
      data = { x: baseData.x, y: baseData.y, y2: highData.y };
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

  // Extra data keys that need their own fetchers, band upper bounds.
  // Series order is stable so duplicate keys (band low + line elsewhere)
  // are deduped at render-time by the seriesData map keying on data-key.
  const extraFetchKeys = series
    .filter((cfg) => cfg.type === "band" && cfg.keyHigh)
    .map((cfg) => cfg.keyHigh as string);

  // Reference curves only make sense on a non-time X axis (they're a
  // function of the X dimension, not time). Silently skip them on time-X
  // graphs rather than silently corrupting the time domain.
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

  const xDomain: [number, number] = xPinned
    ? (config?.xDomain as [number, number])
    : xIsTime
      ? (() => {
          const now = Date.now();
          return [now - windowSec * 1000, now];
        })()
      : computeXDomain(xData.v as number[], overlaySeries, layers);

  const xTickFormat = xIsTime
    ? undefined
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

    // Drop the subtitle when it would only repeat the title. Naming a
    // one-series graph after its series is the obvious thing to do, so
    // "Altitude / Altitude" was the common case rather than the edge one.
    const readoutTitle = title ?? "GRAPH";
    return (
      <Panel panelTitle={readoutTitle} panelAside={headerActions}>
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
        {/* Reuse the standard fetcher so live samples and queryRange backfill
            stay consistent with the chart variant. */}
        <GraphSeries
          key={cfg.id}
          dataKey={cfg.key}
          windowSec={windowSec}
          onData={handleData}
        />
      </Panel>
    );
  }

  const chartBody = (
    <>
      {/* ChartArea is always rendered so the ResizeObserver effect (deps:
          []) attaches once and never has to re-attach when the chart's
          data state flips. The empty-state text overlays when there's no
          data to plot. */}
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
      {/* Invisible data-fetcher components, one per series + one for X when non-time */}
      {series.map((cfg) => (
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
      // PanelTitle uppercases, which is right for a word and WRONG for a unit
      // symbol: "m" and "M" are metre and mega, "mm" and "MM" are not the same
      // quantity. So the word is uppercased by the panel and the units opt out.
      // A consumer passing its own title gets it through unchanged.
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
    >
      {chartBody}
    </Panel>
  );
}

// ── Registered widget ────────────────────────────────────────────────────────

function GraphComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<GraphConfig>>) {
  return <GraphView config={config} w={w} h={h} />;
}

// ── Config component ──────────────────────────────────────────────────────────

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
  // A graph axis orders its values, so it needs the same magnitude a threshold
  // does. Shared with the alarm and trigger pickers rather than re-tested here:
  // this call site used to compare against unit spellings the contract does not
  // emit, and so admitted every flag and enum it meant to exclude.
  const numericKeys = schema.filter(isThresholdSubject);
  // X-axis picker: time is an always-present pseudo-key; numeric data keys below.
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

// ── Styles ────────────────────────────────────────────────────────────────────

// Structural inline styles (CSS-var tokens): a bespoke plot frame + config
// form, no reusable ui-kit primitive fits the layout, so it stays local. The
// two hover-bearing config buttons reuse ui-kit GhostButton / IconButton (the
// only inline-inexpressible bit is `:hover`); the plot slots that need a ref
// for the ResizeObserver stay plain divs (ui-kit Fill is not forwardRef).

// The plot is visual content, so it gets a frame rather than an argument with
// the body inset. `flush`: LineChart already draws inside its own MARGIN, so
// the frame's gutter would read as a double border. A frame rather than
// `floatingHeader`, even though the chart variant's body holds nothing but the
// drawing: LineChart stamps its series legend top-left INSIDE the plot, which
// is exactly where a floating title would land. The readout variant is mixed
// content anyway (a big number and a sparkline), and one widget wants one kind
// of header across both its variants.
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
  fontSize: "var(--font-size-xs)",
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
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-faint)",
  pointerEvents: "none",
};

const AXIS_WARNING: CSSProperties = {
  position: "absolute",
  bottom: "4px",
  right: "8px",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-status-warning-bg)",
  background: "rgba(0, 0, 0, 0.7)",
  padding: "var(--space-2) var(--space-6)",
  borderRadius: "var(--radius-xs)",
  pointerEvents: "none",
};

const SERIES_ROW: CSSProperties = {
  display: "flex",
  gap: "var(--space-6)",
  alignItems: "center",
  marginBottom: "var(--space-6)",
};

const SERIES_GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  marginBottom: "var(--space-4)",
};

const DOMAIN_ROW: CSSProperties = { display: "flex", gap: "var(--space-6)" };

// GhostButton override: a full-width dashed "add" affordance, not uppercase.
// GhostButton supplies the hover (colour lift) `:hover` inline can't; the rest
// is inline. The styled hover also shifted the border to --color-text-dim;
// GhostButton's own hover lifts it to --color-text-faint, a close brighten.
const ADD_BUTTON: CSSProperties = {
  width: "100%",
  borderStyle: "dashed",
  borderColor: "var(--color-text-faint)",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 400,
  letterSpacing: "normal",
  textTransform: "none",
  padding: "var(--space-4) var(--space-8)",
  marginTop: "var(--space-4)",
};

// IconButton override: the "×" remove control. IconButton supplies the hover
// colour lift; the size/colour are inline.
const REMOVE_BUTTON: CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-lg)",
  lineHeight: "var(--line-height-flush)",
  padding: "0 var(--space-4)",
  flexShrink: 0,
};

// Unit symbols are case-sensitive, so they opt out of the header's uppercase.
const GRAPH_UNITS: CSSProperties = { textTransform: "none" };

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<GraphConfig>({
  id: "graph",
  name: "Graph",
  description: "Line chart of one or more live telemetry series over time.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  // Plot area collapses below ~240px tall: give graphs extra room on mobile.
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
  GraphConfig,
  GraphSeriesConfig,
  GraphThresholdConfig,
} from "./types";
export { TIME_AXIS } from "./types";
export { GraphComponent };
