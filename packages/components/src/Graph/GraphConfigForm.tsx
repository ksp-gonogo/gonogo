import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { safeRandomUuid } from "@ksp-gonogo/core";
import { isThresholdSubject, useDataSchema } from "@ksp-gonogo/data";
import {
  ConfigForm,
  DataKeyPicker,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { GhostButton } from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useMemo, useState } from "react";
import { parseDomain, resolveVariantHint } from "./config";
import { SeriesRow } from "./SeriesRow";
import { ThresholdRow } from "./ThresholdRow";
import type {
  GraphConfig,
  GraphSeriesConfig,
  GraphThresholdConfig,
  GraphVariant,
} from "./types";
import { TIME_AXIS } from "./types";

export function GraphConfigComponent({
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
  const variantHint = resolveVariantHint(variant, seriesCount);

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
          <SeriesRow
            key={s.id}
            series={s}
            numericKeys={numericKeys}
            onUpdate={updateSeries}
            onRemove={removeSeries}
          />
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
          <ThresholdRow
            key={t.id}
            threshold={t}
            onUpdate={updateThreshold}
            onRemove={removeThreshold}
          />
        ))}
        <GhostButton type="button" onClick={addThreshold} style={ADD_BUTTON}>
          + Add threshold
        </GhostButton>
      </Field>
    </ConfigForm>
  );
}

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
