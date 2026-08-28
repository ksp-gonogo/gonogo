import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import {
  EmptyState,
  Field,
  FieldLabel,
  NULL_DISPLAY,
  Panel,
  type ReadoutTone,
  Select,
  Stack,
  StatusPill,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { GamepadGlyph } from "../GamepadGlyph";
import { describeGamepadInput } from "../gamepadDisplay";
import type { GamepadRole } from "../gamepadRoles";
import {
  useSerialDeviceService,
  useSerialDeviceStatus,
  useSerialDevices,
  useSerialDeviceTypes,
} from "../SerialDeviceContext";

type InputTesterConfig = {
  deviceId?: string;
};

type ValueMap = Record<string, boolean | number>;

function InputTesterComponent({
  config,
  onConfigChange,
}: Readonly<ComponentProps<InputTesterConfig>>) {
  const svc = useSerialDeviceService();
  const devices = useSerialDevices();
  // Subscribe to device-type changes so a device that swaps schema
  // (json-state) re-renders with its new inputs.
  useSerialDeviceTypes();

  const selectedId =
    config?.deviceId && devices.some((d) => d.id === config.deviceId)
      ? config.deviceId
      : (devices[0]?.id ?? "");

  // Persist the chosen device when it changes (or when config has a stale id).
  useEffect(() => {
    if (!onConfigChange) return;
    if (config?.deviceId === selectedId) return;
    if (!selectedId) return;
    onConfigChange({ ...config, deviceId: selectedId });
  }, [config, selectedId, onConfigChange]);

  const device = devices.find((d) => d.id === selectedId);
  const type = device ? svc.getDeviceType(device.typeId) : undefined;
  const status = useSerialDeviceStatus(selectedId);

  const [values, setValues] = useState<ValueMap>({});

  useEffect(() => {
    // Drop stale values from the previous device whenever the selection
    // changes, so released-but-not-zeroed inputs don't bleed across.
    setValues({});
    if (!selectedId) return;
    return svc.onInput((deviceId, event) => {
      if (deviceId !== selectedId) return;
      setValues((prev) =>
        prev[event.inputId] === event.value
          ? prev
          : { ...prev, [event.inputId]: event.value },
      );
    });
  }, [svc, selectedId]);

  const buttons = useMemo(
    () => (type ? type.inputs.filter((i) => i.kind === "button") : []),
    [type],
  );
  const analogs = useMemo(
    () => (type ? type.inputs.filter((i) => i.kind === "analog") : []),
    [type],
  );

  const handleSelect = (next: string) => {
    onConfigChange?.({ ...config, deviceId: next });
  };

  return (
    <Panel panelTitle="INPUT TESTER" compactTitle={["INPUTS", "INPUT"]}>
      <Field>
        <FieldLabel htmlFor="input-tester-device">Device</FieldLabel>
        <Select
          id="input-tester-device"
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
        >
          {devices.length === 0 && (
            <option value="" disabled>
              (no devices registered)
            </option>
          )}
          {devices.map((d) => {
            const t = svc.getDeviceType(d.typeId);
            return (
              <option key={d.id} value={d.id}>
                {d.name}
                {t ? `: ${t.name}` : ""}
              </option>
            );
          })}
        </Select>
      </Field>

      {!device || !type ? (
        <EmptyState>
          {devices.length === 0
            ? "No devices registered. Add one via the joystick FAB."
            : "Select a device to see its inputs."}
        </EmptyState>
      ) : (
        <>
          <StatusRow>
            <StatusLabel>Status</StatusLabel>
            <StatusPill $tone={STATUS_TONE[status] ?? "default"}>
              {status}
            </StatusPill>
            <Spacer />
            <Counts>
              {buttons.length} btn · {analogs.length} axis
            </Counts>
          </StatusRow>

          {type.inputs.length === 0 && (
            <EmptyState>
              This device type has no inputs declared. Edit the type via the
              joystick FAB → Devices.
            </EmptyState>
          )}

          {analogs.length > 0 && (
            <Stack gap="md">
              <SectionLabel>Axes</SectionLabel>
              {analogs.map((input) => {
                const raw = values[input.id];
                const v = typeof raw === "number" ? raw : 0;
                const live = typeof raw === "number";
                const display = describeGamepadInput(device, input);
                return (
                  <AnalogRow key={input.id}>
                    <AnalogName>
                      {display.glyph && (
                        <GamepadGlyph
                          role={input.role as GamepadRole}
                          pack={device.labelPack ?? "positional"}
                          size={13}
                        />
                      )}
                      {display.name}
                    </AnalogName>
                    <AnalogTrack>
                      <AnalogCentre />
                      <AnalogFill
                        style={{
                          left: v >= 0 ? "50%" : `${50 + v * 50}%`,
                          width: `${Math.abs(v) * 50}%`,
                        }}
                        $live={live}
                      />
                      <AnalogThumb
                        style={{ left: `${50 + v * 50}%` }}
                        $live={live}
                      />
                    </AnalogTrack>
                    <AnalogValue $live={live}>
                      {live ? v.toFixed(2) : NULL_DISPLAY}
                    </AnalogValue>
                  </AnalogRow>
                );
              })}
            </Stack>
          )}

          {buttons.length > 0 && (
            <Stack gap="md">
              <SectionLabel>Buttons</SectionLabel>
              <ButtonGrid>
                {buttons.map((input) => {
                  const pressed = values[input.id] === true;
                  const display = describeGamepadInput(device, input);
                  return (
                    <ButtonPill key={input.id} $pressed={pressed}>
                      <ButtonDot $pressed={pressed} />
                      {display.glyph && (
                        <GamepadGlyph
                          role={input.role as GamepadRole}
                          pack={device.labelPack ?? "positional"}
                          size={13}
                        />
                      )}
                      <ButtonName>{display.name}</ButtonName>
                    </ButtonPill>
                  );
                })}
              </ButtonGrid>
            </Stack>
          )}
        </>
      )}
    </Panel>
  );
}

registerComponent<InputTesterConfig>({
  id: "input-tester",
  name: "Input Tester",
  description:
    "Live read-out of every button and axis on the selected serial device, straight off the transport, no action mapping required. Pick a device from the dropdown, press a button or move an axis, and watch its row light up. Useful for verifying wiring, offsets, and parser min/max before you start mapping inputs to actions.",
  tags: ["input", "debug"],
  defaultSize: { w: 5, h: 6 },
  // An axis row is a fixed instrument: an 80px name, a track wide enough to
  // read a deflection off, and a 48px value. Five columns is the narrowest
  // tile all three fit in.
  minSize: { w: 5, h: 3 },
  component: InputTesterComponent,
  dataRequirements: [],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { InputTesterComponent };

/**
 * The kit's StatusPill is tone-driven; this widget's transport status is a raw
 * string. Mapping it here is the conversion: the pill's colours stop being a
 * private ternary and become the same three tones every other status surface
 * in the dashboard uses.
 */
const STATUS_TONE: Record<string, ReadoutTone> = {
  connected: "go",
  error: "alert",
};

// ── Styles ───────────────────────────────────────────────────────────────────

/* The counts sit on their own line when the status pill has already used the
   width, rather than running off the side of a narrow tile. */
const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-xs);
`;

const StatusLabel = styled.span`
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const Spacer = styled.span`
  flex: 1;
`;

const Counts = styled.span`
  color: var(--color-text-faint);
`;

const SectionLabel = styled.div`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const AnalogRow = styled.div`
  display: grid;
  grid-template-columns: 80px 1fr 48px;
  align-items: center;
  gap: var(--space-8);
`;

const AnalogName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/*
 * AnalogTrack / AnalogCentre / AnalogFill are one nested geometry, not three
 * independent boxes, so every number in them stays literal:
 *
 *  - the track's 4px radius is half its 8px height (a stadium) and the fill's
 *    2px is the same half taken one 1px inset further in. They are a matched
 *    pair; --radius-md / --radius-xs would render identically today but stop
 *    tracking the height the moment it changes.
 *  - the 1px top/bottom insets are border compensation, cancelling the track's
 *    1px rule so the fill sits inside it rather than under it. That is
 *    border geometry, the same class as a focus ring, not the spacing ladder:
 *    at 2px the fill would be a lozenge inside a 6px inner height.
 */
const AnalogTrack = styled.div`
  position: relative;
  height: 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
`;

const AnalogCentre = styled.div`
  position: absolute;
  left: 50%;
  top: 1px;
  bottom: 1px;
  width: 1px;
  background: var(--color-border-strong);
`;

const AnalogFill = styled.div<{ $live: boolean }>`
  position: absolute;
  top: 1px;
  bottom: 1px;
  background: ${({ $live }) =>
    $live ? "var(--color-status-info-fg)" : "transparent"};
  opacity: 0.4;
  border-radius: 2px;
`;

const AnalogThumb = styled.div<{ $live: boolean }>`
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-circle);
  transform: translate(-50%, -50%);
  background: ${({ $live }) =>
    $live ? "var(--color-status-info-fg)" : "var(--color-text-faint)"};
  box-shadow: ${({ $live }) =>
    $live ? "0 0 6px rgba(124, 204, 255, 0.6)" : "none"};
`;

const AnalogValue = styled.span<{ $live: boolean }>`
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: ${({ $live }) =>
    $live ? "var(--color-status-info-fg)" : "var(--color-text-faint)"};
`;

const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--space-6);
`;

const ButtonPill = styled.div<{ $pressed: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-sm);
  border: 1px solid
    ${({ $pressed }) =>
      $pressed ? "var(--color-status-info-fg)" : "var(--color-border-subtle)"};
  background: ${({ $pressed }) =>
    $pressed ? "var(--color-status-info-bg)" : "var(--color-surface-panel)"};
  color: ${({ $pressed }) =>
    $pressed ? "var(--color-status-info-fg)" : "var(--color-text-primary)"};
  font-size: var(--font-size-xs);
  /* 60ms stays literal: it is deliberately faster than the 80ms binding-row
     highlight in InputMappingTab, and --duration-instant is that 80ms. The
     press echo reads as instant only because it undercuts the other one. */
  transition: background 60ms var(--ease-linear);
`;

const ButtonDot = styled.span<{ $pressed: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  flex-shrink: 0;
  background: ${({ $pressed }) =>
    $pressed ? "var(--color-status-info-fg)" : "var(--color-border-strong)"};
  box-shadow: ${({ $pressed }) =>
    $pressed ? "0 0 6px rgba(124, 204, 255, 0.7)" : "none"};
`;

const ButtonName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
