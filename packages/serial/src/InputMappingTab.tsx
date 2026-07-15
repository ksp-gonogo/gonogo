import type { ActionDefinition } from "@ksp-gonogo/core";
import {
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  GhostButton,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type { InputBinding, InputMappings } from "./bindings";
import { GamepadGlyph } from "./GamepadGlyph";
import { describeGamepadInput } from "./gamepadDisplay";
import type { LabelPack } from "./gamepadLabels";
import type { GamepadRole } from "./gamepadRoles";
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
      // A native <select><option> can only hold plain text — no glyph here
      // (see the readout below the select for that). Still resolve the
      // pack's name (e.g. "Cross" instead of "Face South") so the
      // text-only list reads better for a gamepad with a chosen pack.
      const { name } = describeGamepadInput(device, input);
      opts.push({
        value: encode(device.id, input.id),
        label: `${device.name} · ${name}`,
      });
    }
  }
  return opts;
}

/** Resolve everything the readout needs for the currently-bound input, if
 *  any — shown next to the (text-only) select so a gamepad binding reads
 *  at a glance instead of parsing "Face South" out of the dropdown text. */
function resolveBoundDisplay(
  binding: InputBinding | null | undefined,
  devices: DeviceInstance[],
  typeById: Map<string, DeviceType>,
): {
  deviceName: string;
  name: string;
  glyph?: string;
  role?: GamepadRole;
  pack: LabelPack;
} | null {
  if (!binding) return null;
  const device = devices.find((d) => d.id === binding.deviceId);
  if (!device) return null;
  const type = typeById.get(device.typeId);
  const input = type?.inputs.find((i) => i.id === binding.inputId);
  if (!input) return null;
  const { name, glyph } = describeGamepadInput(device, input);
  return {
    deviceName: device.name,
    name,
    glyph,
    role: input.role,
    pack: device.labelPack ?? "positional",
  };
}

/**
 * Heuristic for "the user actually meant to press this control" while in
 * capture mode. Without it, idle stick noise around centre would auto-bind
 * the wrong axis on a row that accepts analog. Buttons must be true (press,
 * not release); analogs must clear half-deflection.
 */
function isCapturable(
  accepts: readonly ActionDefinition["accepts"][number][],
  value: boolean | number,
): boolean {
  if (typeof value === "boolean") {
    return accepts.includes("button") && value === true;
  }
  return accepts.includes("analog") && Math.abs(value) >= 0.5;
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
  const [listeningFor, setListeningFor] = useState<string | null>(null);
  // Track the action under capture in a ref so the onInput callback (registered
  // once per listen session) can read the current value without re-subscribing.
  const listeningRef = useRef<{
    actionId: string;
    accepts: readonly ActionDefinition["accepts"][number][];
  } | null>(null);

  // Drive the dispatcher pause + the input subscription off the listening
  // state. Cleanup runs on Save/Cancel (component unmounts) so capture mode
  // is always released, even if the user closes the modal mid-listen.
  useEffect(() => {
    if (!listeningFor) return;
    svc.setCaptureMode(true);
    const unsub = svc.onInput((deviceId, event) => {
      const target = listeningRef.current;
      if (!target) return;
      if (!isCapturable(target.accepts, event.value)) return;
      setDraft((prev) => ({
        ...prev,
        [target.actionId]: { deviceId, inputId: event.inputId },
      }));
      setListeningFor(null);
    });
    return () => {
      unsub();
      svc.setCaptureMode(false);
    };
  }, [svc, listeningFor]);

  // Esc cancels capture without binding.
  useEffect(() => {
    if (!listeningFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setListeningFor(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listeningFor]);

  useModalSaveBar({
    onSave: () => onSave(draft),
    value: draft,
    saved: mappings,
    extra: onClose ? (
      <GhostButton type="button" onClick={onClose}>
        Cancel
      </GhostButton>
    ) : undefined,
  });

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

  const startListening = (action: ActionDefinition) => {
    listeningRef.current = { actionId: action.id, accepts: action.accepts };
    setListeningFor(action.id);
  };

  const cancelListening = () => {
    setListeningFor(null);
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
          const bound = resolveBoundDisplay(current, devices, typeById);
          const selectId = `input-mapping-${action.id}`;
          const isListening = listeningFor === action.id;
          const otherListening =
            listeningFor !== null && listeningFor !== action.id;

          return (
            <Row key={action.id} $listening={isListening}>
              <Field>
                <FieldLabel htmlFor={selectId}>{action.label}</FieldLabel>
                {action.description && (
                  <FieldHint>{action.description}</FieldHint>
                )}
                <FieldRow>
                  <Select
                    id={selectId}
                    value={currentValue}
                    onChange={(e) => handleChange(action.id, e.target.value)}
                    disabled={isListening}
                    style={{ flex: 1 }}
                  >
                    {opts.map((opt) => (
                      <option key={opt.value || "unbound"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                  {isListening ? (
                    <GhostButton
                      type="button"
                      onClick={cancelListening}
                      aria-label={`Cancel binding for ${action.label}`}
                    >
                      Cancel
                    </GhostButton>
                  ) : (
                    <GhostButton
                      type="button"
                      onClick={() => startListening(action)}
                      disabled={otherListening || devices.length === 0}
                      aria-label={`Capture an input for ${action.label}`}
                    >
                      Bind
                    </GhostButton>
                  )}
                </FieldRow>
                {isListening && (
                  <ListenStatus role="status" aria-live="polite">
                    <ListenDot />
                    Press a {action.accepts.includes("button") ? "button" : ""}
                    {action.accepts.length > 1 ? " or move an " : ""}
                    {action.accepts.includes("analog") ? "axis" : ""}...
                    <EscHint>Esc to cancel</EscHint>
                  </ListenStatus>
                )}
                {!isListening && bound?.glyph && bound.role && (
                  // The select's <option> text already carries the name
                  // (native <option> can't hold arbitrary markup) — this
                  // readout adds the glyph so a gamepad binding is
                  // recognisable at a glance, not just readable.
                  <BoundReadout>
                    <GamepadGlyph role={bound.role} pack={bound.pack} />
                    Bound to {bound.deviceName} · {bound.name}
                  </BoundReadout>
                )}
              </Field>
            </Row>
          );
        })}
      </List>
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

const Row = styled.div<{ $listening: boolean }>`
  background: var(--color-surface-raised);
  border: 1px solid
    ${({ $listening }) =>
      $listening
        ? "var(--color-status-info-fg)"
        : "var(--color-border-subtle)"};
  border-radius: 4px;
  padding: 10px 12px;
  transition: border-color 80ms linear;
`;

const ListenStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-status-info-fg);
`;

const BoundReadout = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
`;

const EscHint = styled.span`
  margin-left: auto;
  color: var(--color-text-faint);
`;

const ListenDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-info-fg);
  box-shadow: 0 0 6px rgba(124, 204, 255, 0.7);

  @media (prefers-reduced-motion: no-preference) {
    animation: input-mapping-pulse 1.2s ease-in-out infinite;
  }

  @keyframes input-mapping-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
`;
