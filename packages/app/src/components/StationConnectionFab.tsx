import {
  BroadcastIcon,
  Fab,
  GhostButton,
  Input,
  PrimaryButton,
  StatusIndicator,
  useModal,
} from "@ksp-gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import type { ConnStatus } from "../peer/PeerClientService";

interface Props {
  hostId: string | null;
  connStatus: ConnStatus;
  /** Called when the user wants to connect to a different host code. */
  onSwitchHost: (hostId: string) => void;
  /**
   * Called when the user wants to drop the current connection and go back
   * to the connection-input screen. Should clear the persisted host id +
   * tear down the data channel.
   */
  onDisconnect: () => void;
  bottom: number;
}

/**
 * Station-side equivalent of the main screen's StationLinkFab. Shows
 * the host code the station is currently connected to (which was
 * otherwise invisible post-connect — a real "where am I?" gap when
 * multiple hosts are in play), plus the connection status, and lets
 * the operator either disconnect entirely or switch to a different
 * host without reloading the page.
 */
export function StationConnectionFab(props: Props) {
  const { open } = useModal();
  const handleClick = () => {
    open(<StationConnectionPanel {...props} />, { title: "Connection" });
  };
  return (
    <Fab
      bottom={props.bottom}
      onClick={handleClick}
      aria-label="Connection"
      title="Connection"
    >
      <BroadcastIcon />
    </Fab>
  );
}

function StationConnectionPanel({
  hostId,
  connStatus,
  onSwitchHost,
  onDisconnect,
}: Props) {
  const [pending, setPending] = useState("");

  return (
    <Wrap>
      <Row>
        <Label>Host ID</Label>
        <Code>{hostId ?? "—"}</Code>
      </Row>
      <Row>
        <Label>Status</Label>
        <StatusIndicator tone={statusTone(connStatus)} live>
          {statusLabel(connStatus)}
        </StatusIndicator>
      </Row>

      <Section>
        <Label>Switch host</Label>
        <SwitchRow>
          <Input
            type="text"
            value={pending}
            placeholder="ABCD"
            maxLength={4}
            onChange={(e) =>
              setPending(e.target.value.toUpperCase().slice(0, 4))
            }
          />
          <PrimaryButton
            type="button"
            disabled={pending.length === 0 || pending === hostId}
            onClick={() => {
              const next = pending.trim().toUpperCase();
              if (!next || next === hostId) return;
              onSwitchHost(next);
            }}
          >
            Connect
          </PrimaryButton>
        </SwitchRow>
        <Hint>
          Enter the four-character code shown on the new host. The current
          connection is dropped before the new one is attempted.
        </Hint>
      </Section>

      <Section>
        <GhostButton type="button" onClick={onDisconnect}>
          Disconnect
        </GhostButton>
        <Hint>
          Clears the saved host and returns to the connect screen. Saved
          dashboard layout, alarms, and fog data stay on this device.
        </Hint>
      </Section>
    </Wrap>
  );
}

function statusTone(status: ConnStatus): "go" | "warn" | "nogo" | "info" {
  if (status === "connected") return "go";
  if (status === "connecting" || status === "reconnecting") return "warn";
  if (status === "disconnected") return "nogo";
  return "info";
}

function statusLabel(status: ConnStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "disconnected":
      return "Disconnected";
    default:
      return "Idle";
  }
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 260px;
  color: var(--color-text-primary);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 12px;
`;

const SwitchRow = styled.div`
  display: flex;
  align-items: stretch;
  gap: 8px;

  & > input {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-family: inherit;
  }
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Code = styled.code`
  color: var(--color-status-info-fg);
  font-size: 18px;
  letter-spacing: 0.12em;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.5;
`;
