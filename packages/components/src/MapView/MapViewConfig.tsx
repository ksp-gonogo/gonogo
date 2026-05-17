import type { ConfigComponentProps } from "@gonogo/core";
import { useDataSchema } from "@gonogo/data";
import {
  ConfigForm,
  DataKeyMultiPicker,
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  PrimaryButton,
  Switch,
} from "@gonogo/ui";
import { useMemo, useState } from "react";
import type { MapViewConfig } from "./types";

export function MapViewConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<MapViewConfig>>) {
  const [trajectoryLength, setTrajectoryLength] = useState(
    String(config?.trajectoryLength ?? 2000),
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(config?.telemetryKeys ?? []),
  );
  const [showPrediction, setShowPrediction] = useState(
    config?.showPrediction ?? true,
  );
  const [baseLayer, setBaseLayer] = useState<"altimetry" | "biome">(
    config?.baseLayer ?? "altimetry",
  );
  const [showHeightShading, setShowHeightShading] = useState(
    config?.showHeightShading ?? false,
  );
  const [showAnomalies, setShowAnomalies] = useState(
    config?.showAnomalies ?? false,
  );
  const [fogAltLoRes, setFogAltLoRes] = useState(
    config?.fogLayers?.altimetryLoRes !== false,
  );
  const [fogAltHiRes, setFogAltHiRes] = useState(
    config?.fogLayers?.altimetryHiRes !== false,
  );
  const [fogBiome, setFogBiome] = useState(config?.fogLayers?.biome !== false);
  const [fogResLoRes, setFogResLoRes] = useState(
    config?.fogLayers?.resourceLoRes !== false,
  );
  const [fogResHiRes, setFogResHiRes] = useState(
    config?.fogLayers?.resourceHiRes !== false,
  );

  const allKeys = useDataSchema("data");

  // Show numeric keys only — exclude booleans, enums and raw values that
  // aren't meaningful in a small telemetry panel.
  const numericKeys = useMemo(
    () =>
      allKeys.filter(
        (k) =>
          k.unit !== "bool" &&
          k.unit !== "enum" &&
          k.unit !== "raw" &&
          k.group !== "Actions",
      ),
    [allKeys],
  );

  const handleSave = () => {
    const keys = numericKeys.map((k) => k.key).filter((k) => selected.has(k));
    onSave({
      trajectoryLength: Math.max(
        1,
        Number.parseInt(trajectoryLength, 10) || 2000,
      ),
      telemetryKeys: keys.length > 0 ? keys : undefined,
      showPrediction,
      baseLayer,
      showHeightShading,
      showAnomalies,
      fogLayers: {
        altimetryLoRes: fogAltLoRes,
        altimetryHiRes: fogAltHiRes,
        biome: fogBiome,
        resourceLoRes: fogResLoRes,
        resourceHiRes: fogResHiRes,
      },
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="map-traj">Trajectory history (points)</FieldLabel>
        <Input
          id="map-traj"
          type="number"
          min={1}
          max={10000}
          value={trajectoryLength}
          onChange={(e) => setTrajectoryLength(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Base map</FieldLabel>
        <FieldRow>
          <Switch
            checked={baseLayer === "biome"}
            onChange={(b) => setBaseLayer(b ? "biome" : "altimetry")}
            label="Biome colours (off = altimetry)"
          />
        </FieldRow>
        <FieldHint>
          Altimetry reveals the body's stock texture; biome paints stock
          per-tile biome colours from SCANsat.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel>Overlays</FieldLabel>
        <FieldRow>
          <Switch
            checked={showPrediction}
            onChange={setShowPrediction}
            label="Trajectory prediction"
          />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={showHeightShading}
            onChange={setShowHeightShading}
            label="Elevation shading"
          />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={showAnomalies}
            onChange={setShowAnomalies}
            label="Anomaly markers"
          />
        </FieldRow>
      </Field>
      <Field>
        <FieldLabel>Fog layers</FieldLabel>
        <FieldRow>
          <Switch
            checked={fogAltHiRes}
            onChange={setFogAltHiRes}
            label="Altimetry HiRes"
          />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={fogAltLoRes}
            onChange={setFogAltLoRes}
            label="Altimetry LoRes"
          />
        </FieldRow>
        <FieldRow>
          <Switch checked={fogBiome} onChange={setFogBiome} label="Biome" />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={fogResHiRes}
            onChange={setFogResHiRes}
            label="Resource HiRes"
          />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={fogResLoRes}
            onChange={setFogResLoRes}
            label="Resource LoRes"
          />
        </FieldRow>
        <FieldHint>
          Each enabled scan type contributes to the fog reveal. Within a
          channel, HiRes-covered tiles reveal more fully than LoRes-only tiles.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel>Telemetry panel</FieldLabel>
        <DataKeyMultiPicker
          keys={numericKeys}
          value={selected}
          onChange={setSelected}
          emptyHint="Connect a data source to see available keys."
        />
        <FieldHint>Selected values are shown below the map.</FieldHint>
      </Field>
      <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
    </ConfigForm>
  );
}
