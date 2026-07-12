import { safeRandomUuid } from "@ksp-gonogo/core";
import {
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
} from "@ksp-gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import type { DeviceInstance, DeviceTransportKind, DeviceType } from "../types";

interface Props {
  initial?: DeviceInstance;
  types: DeviceType[];
  onCancel: () => void;
  onSave: (device: DeviceInstance) => void;
}

export function DeviceEditor({
  initial,
  types,
  onCancel,
  onSave,
}: Readonly<Props>) {
  const [name, setName] = useState(initial?.name ?? "");
  const [typeId, setTypeId] = useState(initial?.typeId ?? types[0]?.id ?? "");
  const [transport, setTransport] = useState<DeviceTransportKind>(
    initial?.transport ?? "virtual",
  );
  const [baudRate, setBaudRate] = useState<number>(initial?.baudRate ?? 9600);

  const handleSave = () => {
    if (!name.trim() || !typeId) return;
    const device: DeviceInstance = {
      id: initial?.id ?? safeRandomUuid(),
      name: name.trim(),
      typeId,
      transport,
      baudRate: transport === "web-serial" ? baudRate : undefined,
    };
    onSave(device);
  };

  return (
    <Wrap>
      {types.length === 0 && (
        <FieldHint>
          Create at least one device type first (Device Types tab).
        </FieldHint>
      )}
      <Field>
        <FieldLabel htmlFor="device-name">Name</FieldLabel>
        <Input
          id="device-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cockpit Panel #1"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="device-type">Type</FieldLabel>
        <Select
          id="device-type"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          {types.length === 0 && (
            <option value="" disabled>
              (no types available)
            </option>
          )}
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="device-transport">Transport</FieldLabel>
        <Select
          id="device-transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value as DeviceTransportKind)}
        >
          <option value="virtual">Virtual (in-app)</option>
          <option value="web-serial">Web Serial (USB)</option>
        </Select>
      </Field>
      {transport === "web-serial" && (
        <Field>
          <FieldLabel htmlFor="device-baud">Baud rate</FieldLabel>
          <Input
            id="device-baud"
            type="number"
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
          />
          <FieldHint>
            After saving, open the device row and click Connect to pick the USB
            port.
          </FieldHint>
        </Field>
      )}
      <FormActions>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={handleSave}>Save device</PrimaryButton>
      </FormActions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
