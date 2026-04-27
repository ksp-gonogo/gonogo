import { Button, GhostButton, Tabs } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import {
  useSerialDeviceService,
  useSerialDeviceStatus,
  useSerialDevices,
  useSerialDeviceTypes,
} from "../SerialDeviceContext";
import type { DeviceInstance, DeviceType } from "../types";
import { isWebSerialSupported } from "../webSerialSupport";
import { DeviceEditor } from "./DeviceEditor";
import { DeviceTypeEditor } from "./DeviceTypeEditor";

export function SerialDevicesMenu() {
  const [tab, setTab] = useState<"devices" | "types">("devices");
  return (
    <Wrap>
      <Tabs
        activeId={tab}
        onChange={(id) => setTab(id as "devices" | "types")}
        tabs={[
          { id: "devices", label: "Devices", content: <DevicesTab /> },
          { id: "types", label: "Device Types", content: <TypesTab /> },
        ]}
      />
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Devices tab
// ---------------------------------------------------------------------------

function DevicesTab() {
  const svc = useSerialDeviceService();
  const devices = useSerialDevices();
  const types = useSerialDeviceTypes();
  const [editing, setEditing] = useState<DeviceInstance | "new" | null>(null);

  if (editing !== null) {
    const initial = editing === "new" ? undefined : editing;
    return (
      <DeviceEditor
        initial={initial}
        types={types}
        onCancel={() => setEditing(null)}
        onSave={(device) => {
          if (initial) svc.updateDevice(device.id, device);
          else svc.addDevice(device);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <List>
      {!isWebSerialSupported() && (
        <WebSerialUnavailableBanner role="status">
          Web Serial is not available in this browser. Virtual devices still
          work; real USB hardware needs a Chromium-based browser on desktop or
          Android.
        </WebSerialUnavailableBanner>
      )}
      <Toolbar>
        <Heading>Registered devices ({devices.length})</Heading>
        <Button
          type="button"
          onClick={() => setEditing("new")}
          disabled={types.length === 0}
        >
          + add device
        </Button>
      </Toolbar>
      {devices.length === 0 && <Empty>No devices yet.</Empty>}
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          typeName={types.find((t) => t.id === device.typeId)?.name ?? "?"}
          onEdit={() => setEditing(device)}
        />
      ))}
    </List>
  );
}

function DeviceRow({
  device,
  typeName,
  onEdit,
}: Readonly<{
  device: DeviceInstance;
  typeName: string;
  onEdit: () => void;
}>) {
  const svc = useSerialDeviceService();
  const status = useSerialDeviceStatus(device.id);

  return (
    <Row>
      <RowHead>
        <RowName>{device.name}</RowName>
        <Status $status={status}>{status}</Status>
      </RowHead>
      <RowMeta>
        {typeName} · {device.transport}
      </RowMeta>
      <RowActions>
        {device.transport === "web-serial" && status !== "connected" && (
          <Button
            type="button"
            onClick={() => {
              void svc.connect(device.id);
            }}
          >
            Connect
          </Button>
        )}
        {status === "connected" && (
          <GhostButton
            onClick={() => {
              void svc.disconnect(device.id);
            }}
          >
            Disconnect
          </GhostButton>
        )}
        <GhostButton onClick={onEdit}>Edit</GhostButton>
        <GhostButton
          onClick={() => {
            void svc.removeDevice(device.id);
          }}
        >
          Remove
        </GhostButton>
      </RowActions>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Device Types tab
// ---------------------------------------------------------------------------

function TypesTab() {
  const svc = useSerialDeviceService();
  const types = useSerialDeviceTypes();
  const [editing, setEditing] = useState<DeviceType | "new" | null>(null);

  if (editing !== null) {
    const initial = editing === "new" ? undefined : editing;
    return (
      <DeviceTypeEditor
        initial={initial}
        onCancel={() => setEditing(null)}
        onSave={(type) => {
          svc.upsertDeviceType(type);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <List>
      <Toolbar>
        <Heading>Registered types ({types.length})</Heading>
        <Button type="button" onClick={() => setEditing("new")}>
          + add type
        </Button>
      </Toolbar>
      {types.length === 0 && <Empty>No device types yet.</Empty>}
      {types.map((type) => (
        <Row key={type.id}>
          <RowHead>
            <RowName>{type.name}</RowName>
          </RowHead>
          <RowMeta>
            {type.inputs.length} input{type.inputs.length === 1 ? "" : "s"} ·
            parser: {type.parser} · render: {type.renderStyleId ?? "none"}
          </RowMeta>
          <RowActions>
            <GhostButton onClick={() => setEditing(type)}>Edit</GhostButton>
            <GhostButton
              onClick={() => {
                void svc.removeDeviceType(type.id);
              }}
            >
              Remove
            </GhostButton>
          </RowActions>
        </Row>
      ))}
    </List>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 440px;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const Heading = styled.h3`
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 12px;
  padding: 8px 0;
`;

const WebSerialUnavailableBanner = styled.div`
  background: var(--color-border-subtle);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 4px;
  color: var(--color-status-warning-bg);
  font-size: 12px;
  line-height: 1.45;
  padding: 10px 12px;
`;

const Row = styled.div`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const RowHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
`;

const RowName = styled.span`
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
`;

const RowMeta = styled.span`
  font-size: 11px;
  color: var(--color-text-faint);
`;

const RowActions = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 6px;
`;

const Status = styled.span<{ $status: string }>`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ $status }) =>
    $status === "connected"
      ? "var(--color-accent-fg)"
      : $status === "error"
        ? "var(--color-status-nogo-fg)"
        : "var(--color-text-faint)"};
`;
