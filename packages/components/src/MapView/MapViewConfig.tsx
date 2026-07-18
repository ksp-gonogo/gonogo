import type { ConfigComponentProps } from "@ksp-gonogo/core";
import { getAllBodies } from "@ksp-gonogo/core";
import { useDataSchema } from "@ksp-gonogo/data";
import {
  ConfigForm,
  DataKeyMultiPicker,
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Select,
  Switch,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
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
  const [bodyOverride, setBodyOverride] = useState(config?.bodyOverride ?? "");

  const allKeys = useDataSchema("data");

  // Stock bodies for the picker. Sorted by name for a predictable list.
  const bodies = useMemo(
    () => [...getAllBodies()].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

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

  const candidate = useMemo<MapViewConfig>(() => {
    const keys = numericKeys.map((k) => k.key).filter((k) => selected.has(k));
    return {
      trajectoryLength: Math.max(
        1,
        Number.parseInt(trajectoryLength, 10) || 2000,
      ),
      telemetryKeys: keys.length > 0 ? keys : undefined,
      showPrediction,
      bodyOverride: bodyOverride || undefined,
    };
  }, [numericKeys, selected, trajectoryLength, showPrediction, bodyOverride]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

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
        <FieldLabel htmlFor="map-body-override">Body</FieldLabel>
        <Select
          id="map-body-override"
          value={bodyOverride}
          onChange={(e) => setBodyOverride(e.target.value)}
        >
          <option value="">Follow vessel</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <FieldHint>
          Pin the map to a specific body to inspect it while the vessel is
          elsewhere. Default follows the active vessel.
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
    </ConfigForm>
  );
}
