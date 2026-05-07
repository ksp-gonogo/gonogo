import type { ComponentProps } from "@gonogo/core";
import { registerComponent } from "@gonogo/core";
import {
  EmptyState,
  Field,
  FieldLabel,
  Panel,
  PanelTitle,
  Select,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
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
    <Panel>
      <PanelTitle>INPUT TESTER</PanelTitle>
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
                {t ? ` — ${t.name}` : ""}
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
            <StatusPill $status={status}>{status}</StatusPill>
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
            <Section>
              <SectionLabel>Axes</SectionLabel>
              {analogs.map((input) => {
                const raw = values[input.id];
                const v = typeof raw === "number" ? raw : 0;
                const live = typeof raw === "number";
                return (
                  <AnalogRow key={input.id}>
                    <AnalogName>{input.name}</AnalogName>
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
                      {live ? v.toFixed(2) : "—"}
                    </AnalogValue>
                  </AnalogRow>
                );
              })}
            </Section>
          )}

          {buttons.length > 0 && (
            <Section>
              <SectionLabel>Buttons</SectionLabel>
              <ButtonGrid>
                {buttons.map((input) => {
                  const pressed = values[input.id] === true;
                  return (
                    <ButtonPill key={input.id} $pressed={pressed}>
                      <ButtonDot $pressed={pressed} />
                      <ButtonName>{input.name}</ButtonName>
                    </ButtonPill>
                  );
                })}
              </ButtonGrid>
            </Section>
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
    "Live read-out of every button and axis on the selected serial device, straight off the transport — no action mapping required. Pick a device from the dropdown, press a button or move an axis, and watch its row light up. Useful for verifying wiring, offsets, and parser min/max before you start mapping inputs to actions.",
  tags: ["input", "debug"],
  defaultSize: { w: 4, h: 6 },
  minSize: { w: 3, h: 3 },
  component: InputTesterComponent,
  dataRequirements: [],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { InputTesterComponent };

// ── Styles ───────────────────────────────────────────────────────────────────

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-xs);
`;

const StatusLabel = styled.span`
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const StatusPill = styled.span<{ $status: string }>`
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 2px;
  color: ${({ $status }) =>
    $status === "connected"
      ? "var(--color-status-go-fg)"
      : $status === "error"
        ? "var(--color-status-nogo-bg)"
        : "var(--color-text-dim)"};
  background: ${({ $status }) =>
    $status === "connected"
      ? "var(--color-status-go-bg)"
      : $status === "error"
        ? "var(--color-status-nogo-fg)"
        : "var(--color-surface-raised)"};
`;

const Spacer = styled.span`
  flex: 1;
`;

const Counts = styled.span`
  color: var(--color-text-faint);
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  gap: 8px;
`;

const AnalogName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

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
  border-radius: 50%;
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
  gap: 6px;
`;

const ButtonPill = styled.div<{ $pressed: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 3px;
  border: 1px solid
    ${({ $pressed }) =>
      $pressed ? "var(--color-status-info-fg)" : "var(--color-border-subtle)"};
  background: ${({ $pressed }) =>
    $pressed ? "var(--color-status-info-bg)" : "var(--color-surface-panel)"};
  color: ${({ $pressed }) =>
    $pressed ? "var(--color-status-info-fg)" : "var(--color-text-primary)"};
  font-size: var(--font-size-xs);
  transition: background 60ms linear;
`;

const ButtonDot = styled.span<{ $pressed: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
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
