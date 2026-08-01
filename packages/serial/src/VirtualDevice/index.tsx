import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  Placeholder,
  Select,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  useSerialDeviceService,
  useSerialDevices,
} from "../SerialDeviceContext";
import { VirtualTransport } from "../transports/VirtualTransport";
import { AnalogPad } from "./AnalogPad";

type VirtualDeviceConfig = {
  deviceId?: string;
};

function VirtualDeviceComponent({
  config,
}: Readonly<ComponentProps<VirtualDeviceConfig>>) {
  const svc = useSerialDeviceService();
  const devices = useSerialDevices();
  const [frame, setFrame] = useState<string | null>(null);

  const device = config?.deviceId
    ? devices.find((d) => d.id === config.deviceId)
    : undefined;
  const type = device ? svc.getDeviceType(device.typeId) : undefined;
  const transport = device ? svc.getTransport(device.id) : undefined;
  const virtual = transport instanceof VirtualTransport ? transport : undefined;

  useEffect(() => {
    if (!virtual) return;
    const initial = virtual.lastFrame;
    if (typeof initial === "string") setFrame(initial);
    return virtual.onFrame((next) => {
      setFrame(
        typeof next === "string" ? next : new TextDecoder().decode(next),
      );
    });
  }, [virtual]);

  if (!device || !type) {
    return (
      <Panel>
        <Placeholder>No virtual device configured</Placeholder>
      </Panel>
    );
  }

  const buttons = type.inputs.filter((i) => i.kind === "button");
  const analogs = type.inputs.filter((i) => i.kind === "analog");

  return (
    <Panel>
      <Title>{device.name}</Title>
      <Subtitle>{type.name}</Subtitle>
      {analogs.length > 0 && (
        <SpacedSection>
          {analogs.map((input) => (
            <AnalogPad
              key={input.id}
              label={input.name}
              onChange={(v) => virtual?.inject(input.id, v)}
              onRelease={() => virtual?.inject(input.id, 0)}
            />
          ))}
        </SpacedSection>
      )}
      {buttons.length > 0 && (
        <ButtonGrid>
          {buttons.map((input) => (
            <MomentaryButton
              key={input.id}
              onPointerDown={() => virtual?.inject(input.id, true)}
              onPointerUp={() => virtual?.inject(input.id, false)}
              onPointerLeave={() => virtual?.inject(input.id, false)}
            >
              {input.name}
            </MomentaryButton>
          ))}
        </ButtonGrid>
      )}
      {frame !== null && (
        <FrameDisplay>
          <FrameLabel>Output</FrameLabel>
          <Frame>{frame}</Frame>
        </FrameDisplay>
      )}
    </Panel>
  );
}

function VirtualDeviceConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<VirtualDeviceConfig>>) {
  const devices = useSerialDevices().filter((d) => d.transport === "virtual");
  const [deviceId, setDeviceId] = useState(
    config?.deviceId ?? devices[0]?.id ?? "",
  );

  const candidate = useMemo<VirtualDeviceConfig>(
    () => ({ deviceId }),
    [deviceId],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="vd-device">Virtual device</FieldLabel>
        <Select
          id="vd-device"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          {devices.length === 0 && (
            <option value="" disabled>
              (no virtual devices registered)
            </option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <FieldHint>
          Add a virtual device via the joystick FAB → Devices → Add device.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

registerComponent<VirtualDeviceConfig>({
  id: "virtual-device",
  name: "Virtual Device",
  description:
    "On-screen buttons and sticks that drive a virtual serial device so you can test mappings without hardware.",
  tags: ["input", "debug"],
  defaultSize: { w: 6, h: 8 },
  component: VirtualDeviceComponent,
  configComponent: VirtualDeviceConfigComponent,
  openConfigOnAdd: true,
  defaultConfig: {},
});

export { VirtualDeviceComponent };

const Title = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.05em;
`;

const Subtitle = styled.div`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  margin-bottom: var(--space-6);
`;

const SpacedSection = styled(Stack).attrs({ gap: "md" as const })`
  margin-bottom: var(--space-10);
`;

const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-6);
`;

const MomentaryButton = styled.button`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 700;
  padding: var(--space-10) 0;
  cursor: pointer;
  user-select: none;
  touch-action: none;

  @media (hover: hover) {
    &:hover {
      background: var(--color-border-subtle);
      border-color: var(--color-status-info-fg);
    }
  }

  &:active {
    background: var(--color-status-info-bg);
    border-color: var(--color-status-info-fg);
    color: var(--color-status-info-fg);
  }

  @media (pointer: coarse) {
    min-height: 44px;
  }
`;

const FrameDisplay = styled.div`
  margin-top: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const FrameLabel = styled.span`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const Frame = styled.pre`
  background: var(--color-surface-app);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-md);
  color: var(--color-status-info-fg);
  /* Both literal: this pre renders the device's 21x8 ASCII frame buffer, so
     11px is the cell width that keeps 21 columns on one line (--font-size-xs
     is 12px under @media (pointer: coarse) and reflows it) and 1.15 is the
     buffer's physical row pitch, not typography. */
  font-size: 11px;
  line-height: 1.15;
  padding: var(--space-8);
  margin: 0;
  white-space: pre;
  overflow-x: auto;
`;
