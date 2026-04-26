import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { registerComponent } from "@gonogo/core";
import type { DataKeyMeta, SeriesRange } from "@gonogo/data";
import { useDataSchema } from "@gonogo/data";
import type { ChartSeries } from "@gonogo/ui";
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
} from "@gonogo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { alignXY } from "./align";
import { GraphSeries } from "./GraphSeries";
import { paletteColor } from "./palette";
import type { GraphConfig, GraphSeriesConfig } from "./types";
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

// ── Component ─────────────────────────────────────────────────────────────────

function GraphComponent({ config }: Readonly<ComponentProps<GraphConfig>>) {
  const series = (config?.series ?? []).map(withDefaults);
  const windowSec = config?.windowSec ?? 300;
  const xKey = config?.xKey ?? TIME_AXIS;
  const xIsTime = xKey === TIME_AXIS;

  const schema = useDataSchema("data");
  const metaMap = new Map(schema.map((k) => [k.key, k]));
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

  const chartSeries: ChartSeries[] = series.map((cfg, i) => {
    const meta = metaMap.get(cfg.key);
    const raw = seriesData.get(cfg.key) ?? { t: [], v: [] };
    const data = xIsTime
      ? { x: raw.t, y: raw.v as number[] }
      : alignXY(raw as SeriesRange<number>, xData);
    return {
      id: cfg.id,
      label: cfg.label ?? meta?.label ?? cfg.key,
      axis: axes[i],
      color: cfg.color ?? paletteColor(i),
      type: cfg.type ?? "line",
      data,
    };
  });

  const xDomain: [number, number] = xIsTime
    ? (() => {
        const now = Date.now();
        return [now - windowSec * 1000, now];
      })()
    : computeValueDomain(xData.v as number[]);

  const xTickFormat = xIsTime
    ? undefined
    : (value: number) => formatNumericTick(value, xMeta?.unit);

  return (
    <Panel>
      <Header>
        <PanelTitle>GRAPH</PanelTitle>
      </Header>
      {series.length === 0 ? (
        <EmptyState>Configure series to begin graphing.</EmptyState>
      ) : (
        <ChartArea ref={containerRef}>
          {size && (
            <LineChart
              series={chartSeries}
              xDomain={xDomain}
              xTickFormat={xTickFormat}
              yDomainPrimary={config?.yDomainPrimary}
              yDomainSecondary={config?.yDomainSecondary}
              width={size.w}
              height={size.h}
            />
          )}
          {hasThirdUnit && (
            <AxisWarning>Add explicit axes to plot 3+ units</AxisWarning>
          )}
        </ChartArea>
      )}
      {/* Invisible data-fetcher components, one per series + one for X when non-time */}
      {series.map((cfg) => (
        <GraphSeries
          key={cfg.id}
          dataKey={cfg.key}
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
      { id: crypto.randomUUID(), key: "", type: "line", axis: "auto" },
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

  const handleSave = () => {
    onSave({
      ...config,
      series: seriesList.filter((s) => s.key !== ""),
      windowSec: Math.max(10, Number.parseInt(windowSec, 10) || 300),
      xKey,
      yDomainPrimary: parseDomain(yMinPrimary, yMaxPrimary),
      yDomainSecondary: parseDomain(yMinSecondary, yMaxSecondary),
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
          <SeriesRow key={s.id}>
            <DataKeyPicker
              keys={numericKeys}
              value={s.key || null}
              onChange={(k) => updateSeries(s.id, { key: k ?? "" })}
              placeholder="Pick a key…"
              clearable
            />
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
        </DomainRow>
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

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #222;
`;

const ChartArea = styled.div`
  flex: 1;
  position: relative;
  min-height: 0;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #555;
  font-family: monospace;
`;

const AxisWarning = styled.div`
  position: absolute;
  bottom: 4px;
  right: 8px;
  font-size: 10px;
  color: #ff8c00;
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

const DomainRow = styled.div`
  display: flex;
  gap: 6px;
`;

const AddButton = styled.button`
  background: none;
  border: 1px dashed #444;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  font-family: monospace;
  padding: 4px 8px;
  width: 100%;
  margin-top: 4px;
  &:hover { color: #ccc; border-color: #666; }
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  flex-shrink: 0;
  &:hover { color: #ccc; }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<GraphConfig>({
  id: "graph",
  name: "Graph",
  description: "Line chart of one or more live telemetry series over time.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
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

export { GraphComponent };
