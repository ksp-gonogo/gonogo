import type { ActionDefinition } from "@gonogo/core";
import {
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import type { InputBinding, InputMappings } from "./bindings";
import { useSerialDeviceService } from "./SerialDeviceContext";
import type { DeviceInstance, DeviceType } from "./types";

interface InputMappingTabProps {
  actions: readonly ActionDefinition[];
  mappings: InputMappings;
  onSave: (next: InputMappings) => void;
  onClose?: () => void;
}

interface PickerOption {
  value: string; // encoded as `${deviceId}::${inputId}` or "" for unbound
  label: string;
}

function encode(deviceId: string, inputId: string): string {
  return `${deviceId}::${inputId}`;
}

function decode(value: string): InputBinding | null {
  if (!value) return null;
  const [deviceId, inputId] = value.split("::");
  return deviceId && inputId ? { deviceId, inputId } : null;
}

function optionsForAction(
  action: ActionDefinition,
  devices: DeviceInstance[],
  typeById: Map<string, DeviceType>,
): PickerOption[] {
  const opts: PickerOption[] = [{ value: "", label: "— unbound —" }];
  for (const device of devices) {
    const type = typeById.get(device.typeId);
    if (!type) continue;
    for (const input of type.inputs) {
      if (!action.accepts.includes(input.kind)) continue;
      opts.push({
        value: encode(device.id, input.id),
        label: `${device.name} · ${input.name}`,
      });
    }
  }
  return opts;
}

export function InputMappingTab({
  actions,
  mappings,
  onSave,
  onClose,
}: Readonly<InputMappingTabProps>) {
  const svc = useSerialDeviceService();
  const devices = svc.getDevices();
  const typeById = useMemo(() => {
    const map = new Map<string, DeviceType>();
    for (const t of svc.getDeviceTypes()) map.set(t.id, t);
    return map;
    // getDeviceTypes is a stable ref via the service; the list only changes
    // when the user edits types in the serial menu, which the parent modal
    // isn't live for.
  }, [svc]);

  const [draft, setDraft] = useState<InputMappings>(() => ({ ...mappings }));

  if (actions.length === 0) {
    return (
      <Empty>
        This component does not expose any actions, so there is nothing to bind.
      </Empty>
    );
  }

  const handleChange = (actionId: string, raw: string) => {
    setDraft((prev) => ({ ...prev, [actionId]: decode(raw) }));
  };

  return (
    <Wrap>
      {devices.length === 0 && (
        <FieldHint>
          No serial devices registered yet. Open the joystick FAB to add one.
        </FieldHint>
      )}
      <List>
        {actions.map((action) => {
          const opts = optionsForAction(action, devices, typeById);
          const current = draft[action.id];
          const currentValue = current
            ? encode(current.deviceId, current.inputId)
            : "";
          const selectId = `input-mapping-${action.id}`;
          return (
            <Row key={action.id}>
              <Field>
                <FieldLabel htmlFor={selectId}>{action.label}</FieldLabel>
                {action.description && (
                  <FieldHint>{action.description}</FieldHint>
                )}
                <Select
                  id={selectId}
                  value={currentValue}
                  onChange={(e) => handleChange(action.id, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt.value || "unbound"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </Row>
          );
        })}
      </List>
      <Actions>
        {onClose && <GhostButton onClick={onClose}>Cancel</GhostButton>}
        <PrimaryButton onClick={() => onSave(draft)}>Save</PrimaryButton>
      </Actions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Empty = styled.div`
  color: var(--color-text-dim);
  font-size: 12px;
  padding: 8px 0;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Row = styled.div`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 10px 12px;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
