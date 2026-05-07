import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { registerComponent, safeRandomUuid } from "@gonogo/core";
import type { DataKeyMeta, SeriesRange } from "@gonogo/data";
import { useDataSchema } from "@gonogo/data";
import type { ChartSeries, ChartSeriesData, ThresholdRule } from "@gonogo/ui";
import {
  ConfigForm,
  DataKeyPicker,
  Field,
  FieldLabel,
  Input,
  LineChart,
  Panel,
  PanelTitle,
  PrimaryButton,
  Select,
  WidgetHeader,
} from "@gonogo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { alignXY } from "./align";
import { GraphSeries } from "./GraphSeries";
import { paletteColor } from "./palette";
import type {
  GraphConfig,
  GraphSeriesConfig,
  GraphThresholdConfig,
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
): [number, number] {
  const all = [...liveXs];
  for (const o of overlays) all.push(...o.data.x);
  return computeValueDomain(all);
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
  if (configs.every((c) => c.axis !== "auto")) {
    return configs.map((c) => c.axis as "primary" | "secondary");
  }
  const units = configs.map((c) => metaMap.get(c.key)?.unit ?? "raw");
  const seen: string[] = [];
  for (const u of units) {
    if (!seen.includes(u)) seen.push(u);
  }
  return configs.map((c) => {
    if (c.axis !== "auto") return c.axis as "primary" | "secondary";
    const u = metaMap.get(c.key)?.unit ?? "raw";
    return seen.indexOf(u) === 0 ? "primary" : "secondary";
  });
}

// ── GraphView ────────────────────────────────────────────────────────────────
//
// The shared rendering engine. Takes a resolved GraphConfig and optional
// reference curves (pre-computed by the caller — typically a domain-specific
// preset widget like OrbitalAscent that wants to overlay an ideal curve on top
// of live telemetry). Curves are injected as synthetic ChartSeries entries
// alongside the live ones; the X domain expands to cover them.

/**
 * A pre-computed reference curve to overlay on the chart. The caller is
 * responsible for sampling whatever function it wants to display (e.g.
 * `circularOrbitVelocity` over an altitude range) and producing the parallel
 * `xs` / `ys` arrays. No data subscription happens for these — they are
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
  /** Override the panel header. Defaults to "GRAPH". */
  title?: string;
  /** Replaces the empty-state copy when no series are configured. */
  emptyState?: string;
}

export function GraphView({
  config,
  referenceCurves,
  title = "GRAPH",
  emptyState = "Configure series to begin graphing.",
}: GraphViewProps) {
  const series = useMemo(
    () => (config?.series ?? []).map(withDefaults),
    [config?.series],
  );
  const windowSec = config?.windowSec ?? 300;
  const xKey = config?.xKey ?? TIME_AXIS;
  const xIsTime = xKey === TIME_AXIS;

  const schema = useDataSchema("data");
  // Schema is ~150 entries today; rebuilding the lookup map every render
  // (Graph re-renders on each child's onData callback ≈ 4 Hz) was
  // ~600 hash inserts/sec for no reason. Memo against the schema array
  // identity (stable thanks to useDataSchema's own memo).
  const metaMap = useMemo(
    () => new Map(schema.map((k) => [k.key, k])),
    [schema],
  );
  const xMeta = xIsTime ? null : (metaMap.get(xKey) ?? null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collected numeric series data from child GraphSeries components.
  // Contains Y-series data keyed by their data-key. When xKey is a data key
  // (not time), xData is fetched in parallel and held separately so we can
  // re-pair samples at render time.
  const [seriesData, setSeriesData] = useState<
    Map<string, SeriesRange<number>>
  >(new Map());
  const [xData, setXData] = useState<SeriesRange<number>>({ t: [], v: [] });

  // Clear stale X buffer when the X key changes — otherwise the first frame
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
      // Pair by index — both are clipped to the shared window already, and
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

  // Extra data keys that need their own fetchers — band upper bounds.
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

  const xDomain: [number, number] = xIsTime
    ? (() => {
        const now = Date.now();
        return [now - windowSec * 1000, now];
      })()
    : computeXDomain(xData.v as number[], overlaySeries);

  const xTickFormat = xIsTime
    ? undefined
    : (value: number) => formatNumericTick(value, xMeta?.unit);

  return (
    <Panel>
      <WidgetHeader>
        <PanelTitle>{title}</PanelTitle>
      </WidgetHeader>
      {/* ChartArea is always rendered so the ResizeObserver effect (deps:
          []) attaches once and never has to re-attach when the chart's
          data state flips. The empty-state text overlays when there's no
          data to plot. */}
      <ChartArea ref={containerRef}>
        {size && (
          <LineChart
            series={chartSeries}
            xDomain={xDomain}
            xTickFormat={xTickFormat}
            yDomainPrimary={config?.yDomainPrimary}
            yDomainSecondary={config?.yDomainSecondary}
            yScalePrimary={config?.yScalePrimary}
            yScaleSecondary={config?.yScaleSecondary}
            thresholds={config?.thresholds as ThresholdRule[] | undefined}
            width={size.w}
            height={size.h}
          />
        )}
        {hasThirdUnit && (
          <AxisWarning>Add explicit axes to plot 3+ units</AxisWarning>
        )}
        {series.length === 0 && overlaySeries.length === 0 && (
          <EmptyStateOverlay>{emptyState}</EmptyStateOverlay>
        )}
      </ChartArea>
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
      {!xIsTime && (
        <GraphSeries
          key={`x-${xKey}`}
          dataKey={xKey}
          windowSec={windowSec}
          onData={handleXData}
        />
      )}
    </Panel>
  );
}

// ── Registered widget ────────────────────────────────────────────────────────

function GraphComponent({ config }: Readonly<ComponentProps<GraphConfig>>) {
  return <GraphView config={config} />;
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

  const schema = useDataSchema("data");
  const numericKeys = schema.filter(
    (k) =>
      k.unit !== "bool" &&
      k.unit !== "enum" &&
      k.unit !== "raw" &&
      k.group !== "Actions",
  );
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

  const handleSave = () => {
    onSave({
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
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel>X axis</FieldLabel>
        <DataKeyPicker
          keys={xKeyOptions}
          value={xKey}
          onChange={(k) => setXKey(k ?? TIME_AXIS)}
          placeholder="Pick an X-axis key…"
        />
      </Field>
      <Field>
        <FieldLabel>Series</FieldLabel>
        {seriesList.map((s) => (
          <SeriesGroup key={s.id}>
            <SeriesRow>
              <DataKeyPicker
                keys={numericKeys}
                value={s.key || null}
                onChange={(k) => updateSeries(s.id, { key: k ?? "" })}
                placeholder={
                  s.type === "band" ? "Pick lower bound…" : "Pick a key…"
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
              <RemoveButton type="button" onClick={() => removeSeries(s.id)}>
                ×
              </RemoveButton>
            </SeriesRow>
            {s.type === "band" && (
              <SeriesRow>
                <DataKeyPicker
                  keys={numericKeys}
                  value={s.keyHigh ?? null}
                  onChange={(k) => updateSeries(s.id, { keyHigh: k ?? "" })}
                  placeholder="Pick upper bound…"
                  clearable
                />
              </SeriesRow>
            )}
          </SeriesGroup>
        ))}
        <AddButton type="button" onClick={addSeries}>
          + Add series
        </AddButton>
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
        <DomainRow>
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
        </DomainRow>
      </Field>
      <Field>
        <FieldLabel>Secondary Y range (leave blank for auto)</FieldLabel>
        <DomainRow>
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
        </DomainRow>
      </Field>
      <Field>
        <FieldLabel>Threshold lines</FieldLabel>
        {thresholds.map((t) => (
          <SeriesRow key={t.id}>
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
            <RemoveButton type="button" onClick={() => removeThreshold(t.id)}>
              ×
            </RemoveButton>
          </SeriesRow>
        ))}
        <AddButton type="button" onClick={addThreshold}>
          + Add threshold
        </AddButton>
      </Field>
      <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
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

const ChartArea = styled.div`
  flex: 1;
  position: relative;
  min-height: 0;
`;

const EmptyStateOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-faint);
  pointer-events: none;
`;

const AxisWarning = styled.div`
  position: absolute;
  bottom: 4px;
  right: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-status-warning-bg);
  background: rgba(0, 0, 0, 0.7);
  padding: 2px 6px;
  border-radius: 2px;
  pointer-events: none;
`;

const SeriesRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
`;

const SeriesGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 4px;
`;

const DomainRow = styled.div`
  display: flex;
  gap: 6px;
`;

const AddButton = styled.button`
  background: none;
  border: 1px dashed var(--color-text-faint);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  width: 100%;
  margin-top: 4px;
  &:hover { color: var(--color-text-primary); border-color: var(--color-text-dim); }
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-dim);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  flex-shrink: 0;
  &:hover { color: var(--color-text-primary); }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<GraphConfig>({
  id: "graph",
  name: "Graph",
  description: "Line chart of one or more live telemetry series over time.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  // Plot area collapses below ~240px tall — give graphs extra room on mobile.
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
