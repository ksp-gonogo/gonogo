import { Button, GhostButton, Tabs } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import { CHROMIUM_ONLY_SURFACES } from "../capabilities";
import {
  useSerialDeviceService,
  useSerialDeviceStatus,
  useSerialDevices,
  useSerialDeviceTypes,
  useSerialPendingChoices,
} from "../SerialDeviceContext";
import type { DeviceInstance, DeviceType } from "../types";
import { getWebSerialSupport } from "../webSerialSupport";
import { DeviceEditor } from "./DeviceEditor";
import { DeviceTypeEditor } from "./DeviceTypeEditor";
import { SelfDescribingAddWizard } from "./SelfDescribingAddWizard";

// The capability registry is the source of truth for "what's Chromium-only" —
// pull the feature label shown in the unsupported-browser banner from there
// instead of hardcoding it a second time in this component.
const foundWebSerialFeature = CHROMIUM_ONLY_SURFACES.find(
  (s) => s.id === "web-serial",
);
if (!foundWebSerialFeature) {
  throw new Error(
    "capabilities registry is missing the web-serial entry SerialDevicesMenu depends on",
  );
}
// Re-bind with the narrowed (non-undefined) type — the guard above narrows
// `foundWebSerialFeature` only within this scope, not for the closures below
// that reference it, so assign it once to a const whose inferred type
// already excludes `undefined`.
const WEB_SERIAL_FEATURE: (typeof CHROMIUM_ONLY_SURFACES)[number] =
  foundWebSerialFeature;

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
  const pendingChoices = useSerialPendingChoices();
  const [editing, setEditing] = useState<DeviceInstance | "new" | null>(null);
  const [adding, setAdding] = useState<"self-describing" | null>(null);
  const support = getWebSerialSupport();

  if (adding === "self-describing") {
    return <SelfDescribingAddWizard onClose={() => setAdding(null)} />;
  }

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
      {!support.supported && <WebSerialBanner reason={support.reason} />}
      <Toolbar>
        <Heading>Registered devices ({devices.length})</Heading>
        <ToolbarButtons>
          {support.supported && (
            <Button
              type="button"
              onClick={() => setAdding("self-describing")}
              title="Pair a json-state controller without manually creating a device type"
            >
              + add self-describing
            </Button>
          )}
          <Button
            type="button"
            onClick={() => setEditing("new")}
            disabled={types.length === 0}
          >
            + add device
          </Button>
        </ToolbarButtons>
      </Toolbar>
      {devices.length === 0 && <Empty>No devices yet.</Empty>}
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          typeName={types.find((t) => t.id === device.typeId)?.name ?? "?"}
          pendingChoices={pendingChoices.get(device.id)}
          onEdit={() => setEditing(device)}
        />
      ))}
    </List>
  );
}

function WebSerialBanner({
  reason,
}: Readonly<{ reason: "insecure-context" | "unsupported-browser" }>) {
  if (reason === "insecure-context") {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "this page";
    return (
      <WebSerialUnavailableBanner role="status">
        <BannerLabel>{WEB_SERIAL_FEATURE.label} unavailable —</BannerLabel> Web
        Serial is blocked because <code>{origin}</code> isn't a secure context.
        Chrome only exposes USB serial over HTTPS or{" "}
        <code>http://localhost</code>. Either open the app via{" "}
        <code>localhost</code>/HTTPS, or whitelist this origin at{" "}
        <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>{" "}
        and relaunch. Virtual devices work regardless.
      </WebSerialUnavailableBanner>
    );
  }
  return (
    <WebSerialUnavailableBanner role="status">
      <BannerLabel>{WEB_SERIAL_FEATURE.label} unavailable —</BannerLabel> Web
      Serial is not available in this browser. Virtual devices still work; real
      USB hardware needs a Chromium-based browser on desktop or Android.
    </WebSerialUnavailableBanner>
  );
}

function DeviceRow({
  device,
  typeName,
  pendingChoices,
  onEdit,
}: Readonly<{
  device: DeviceInstance;
  typeName: string;
  pendingChoices?: readonly SerialPort[];
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
      {pendingChoices && pendingChoices.length > 1 && (
        <PendingPicker role="status" aria-live="polite">
          <PendingHint>
            {pendingChoices.length} ports match this device. Pick one — the
            others can stay disconnected, or be assigned to a separate saved
            device.
          </PendingHint>
          <PendingActions>
            {pendingChoices.map((_, idx) => (
              <Button
                // biome-ignore lint/suspicious/noArrayIndexKey: ports have no stable id; index labels them in this UI
                key={idx}
                type="button"
                onClick={() => {
                  void svc.resolvePendingChoice(device.id, idx);
                }}
              >
                Use port {String.fromCharCode(65 + idx)}
              </Button>
            ))}
          </PendingActions>
        </PendingPicker>
      )}
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
        {device.transport === "web-serial" && status === "error" && (
          <GhostButton
            onClick={() => {
              if (
                window.confirm(
                  "Reset will refresh the page. Use this when a device is stuck after an unplug → replug cycle. Other unsaved app state will be lost.",
                )
              ) {
                window.location.reload();
              }
            }}
            title="Refreshes the page — only Web Serial knows how to release a stuck-open SerialPort, and only a fresh JS context lets it"
          >
            Reset connection
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

  // Hide device-authored types — they're created and torn down with their
  // owning self-describing device, so showing them in the editor would
  // invite the user to "remove" something that's just going to come back
  // (or worse, leave the device dangling).
  const editableTypes = types.filter((t) => t.authoredBy !== "device");

  return (
    <List>
      <Toolbar>
        <Heading>Registered types ({editableTypes.length})</Heading>
        <Button type="button" onClick={() => setEditing("new")}>
          + add type
        </Button>
      </Toolbar>
      {editableTypes.length === 0 && <Empty>No device types yet.</Empty>}
      {editableTypes.map((type) => (
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
  gap: 8px;
`;

const ToolbarButtons = styled.div`
  display: flex;
  gap: 6px;
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

const BannerLabel = styled.strong`
  font-weight: 700;
`;

const WebSerialUnavailableBanner = styled.div`
  background: var(--color-border-subtle);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: 4px;
  color: var(--color-status-warning-bg);
  font-size: 12px;
  line-height: 1.45;
  padding: 10px 12px;

  code {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    word-break: break-all;
    background: var(--color-surface-raised);
    border-radius: 3px;
    padding: 0 3px;
  }
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

const PendingPicker = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--color-status-warning-bg);
  border-radius: 3px;
  color: var(--color-text-primary);
`;

const PendingHint = styled.span`
  font-size: var(--font-size-xs);
`;

const PendingActions = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
