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
import type { LabelPack } from "../gamepadLabels";
import { GAMEPAD_PLACEHOLDER_TYPE } from "../seeds";
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
  // `undefined` is the "auto-detect from pad" sentinel — distinct from any
  // real pack choice, so a brand new device that never touches this field
  // still lets SerialDeviceService preselect a pack on first pairing (see
  // handleSchemaUpdate). Once the user (or detection) sets a real value,
  // re-opening this editor shows and preserves that choice instead.
  const [labelPack, setLabelPack] = useState<LabelPack | undefined>(
    initial?.labelPack,
  );
  const isGamepad = transport === "gamepad";
  const isNewGamepadDevice = isGamepad && !initial;

  const handleSave = () => {
    if (!name.trim()) return;
    // A brand new gamepad device has no shape to key a type on yet — it
    // always starts on the shared placeholder, which SerialDeviceService
    // re-points at a shape-derived type the moment it first pairs. Editing
    // an already-paired gamepad device keeps whatever typeId it has.
    const resolvedTypeId = isNewGamepadDevice
      ? GAMEPAD_PLACEHOLDER_TYPE.id
      : isGamepad
        ? (initial?.typeId ?? GAMEPAD_PLACEHOLDER_TYPE.id)
        : typeId;
    if (!resolvedTypeId) return;
    const device: DeviceInstance = {
      id: initial?.id ?? safeRandomUuid(),
      name: name.trim(),
      typeId: resolvedTypeId,
      transport,
      baudRate: transport === "web-serial" ? baudRate : undefined,
      labelPack: isGamepad ? labelPack : undefined,
      // gamepadId is intentionally omitted here (not just set to
      // undefined) — SerialDeviceService's updateDevice merge preserves an
      // existing instance's gamepadId only when the key is absent from
      // this object, and this editor never lets the user set/clear it.
    };
    onSave(device);
  };

  return (
    <Wrap>
      {!isGamepad && types.length === 0 && (
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
      {!isGamepad && (
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
      )}
      <Field>
        <FieldLabel htmlFor="device-transport">Transport</FieldLabel>
        <Select
          id="device-transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value as DeviceTransportKind)}
        >
          <option value="virtual">Virtual (in-app)</option>
          <option value="web-serial">Web Serial (USB)</option>
          <option value="gamepad">Gamepad (Xbox / DualSense / any)</option>
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
      {isGamepad && (
        <Field>
          <FieldLabel htmlFor="device-label-pack">Button labels</FieldLabel>
          <Select
            id="device-label-pack"
            value={labelPack ?? ""}
            onChange={(e) =>
              setLabelPack(
                (e.target.value || undefined) as LabelPack | undefined,
              )
            }
          >
            <option value="">Auto-detect from pad</option>
            <option value="positional">
              Positional (name only, no glyphs)
            </option>
            <option value="xbox">Xbox</option>
            <option value="playstation">PlayStation</option>
            <option value="nintendo">Nintendo</option>
          </Select>
          <FieldHint>
            After saving, open the device row, click Connect, then press any
            button on the pad — the Gamepad API only reports a controller once
            it sees a press, not on plug-in. Auto-detect picks a pack from the
            pad's reported name the first time it pairs; your choice here (or
            later) is never reset automatically.
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
