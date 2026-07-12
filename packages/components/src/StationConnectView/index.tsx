/**
 * Presentational "Connect to Mission Control" screen used by the station
 * pre-connection state. Extracted from `@ksp-gonogo/app`'s StationScreen so the
 * exact same markup the operator sees can be driven through the component
 * render-harness at multiple mobile breakpoints — single-source, no
 * probe-only copy that can drift from production.
 *
 * Pure presentational: depends only on `@ksp-gonogo/ui` primitives plus injected
 * slots. The station name editor (which needs app-scoped React context) and
 * the download-logs action arrive as props/slots so this view carries no
 * `@ksp-gonogo/app` dependency — that would be a reverse edge in the workspace
 * graph. State (host input value, connection status) is owned by the caller;
 * the harness exercises the idle / error / reconnecting states purely by
 * varying the props, so no PeerClientService ever has to be mocked.
 */
import { StatusIndicator } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import styled from "styled-components";

/** Connection lifecycle states surfaced on the connect screen. Mirrors the
 *  `ConnStatus` union the PeerClientService emits — duplicated here as a
 *  plain string union so the view stays free of any app/peer import. */
export type StationConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface StationConnectViewProps {
  /** Current value of the host-code input. */
  hostInput: string;
  /** Live connection status from the peer client. */
  connStatus: StationConnStatus;
  /** Broker couldn't resolve the code on the most recent attempt. */
  hostNotFound: boolean;
  /** This station reached "connected" at least once this session. */
  everConnected: boolean;
  /** Fired on every keystroke in the host-code input. */
  onHostInputChange: (value: string) => void;
  /** Fired when the user submits a code (button click or Enter). */
  onConnect: (hostId: string) => void;
  /** Fired when the user taps "Download logs". */
  onDownloadLogs: () => void;
  /** Slot for the app-scoped station-name editor (needs React context). */
  nameEditor?: ReactNode;
}

export function StationConnectView({
  hostInput,
  connStatus,
  hostNotFound,
  everConnected,
  onHostInputChange,
  onConnect,
  onDownloadLogs,
  nameEditor,
}: StationConnectViewProps) {
  return (
    <ConnectLayout as="main" aria-label="Connect to mission control">
      <ConnectBox>
        <h1>Connect to Mission Control</h1>
        <p>Enter the 4-character host ID shown on the main screen.</p>
        <Row>
          <HostInput
            value={hostInput}
            onChange={(e) => onHostInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConnect(hostInput)}
            placeholder="e.g. AB3K"
            maxLength={8}
            aria-label="Host ID"
            autoFocus
          />
          <ConnectButton
            type="button"
            onClick={() => onConnect(hostInput)}
            disabled={connStatus === "connecting"}
          >
            {connStatus === "connecting" ? "Connecting…" : "Connect"}
          </ConnectButton>
        </Row>
        {nameEditor && <NameRow>{nameEditor}</NameRow>}
        {hostNotFound && everConnected && (
          <ReconnectMsg role="status" aria-live="polite">
            Host reconnecting… The main screen is restarting and will be back
            shortly — this station reconnects automatically.
          </ReconnectMsg>
        )}
        {hostNotFound && !everConnected && (
          <ErrorMsg>
            Couldn't find code &ldquo;{hostInput.trim().toUpperCase()}&rdquo;.
            Check the main screen — the code may have changed, or the
            main-screen tab may be closed/asleep.
          </ErrorMsg>
        )}
        {!hostNotFound && connStatus === "disconnected" && (
          <ErrorMsg>Connection lost. Check the host ID and try again.</ErrorMsg>
        )}
        <StatusIndicator
          tone={statusTone(connStatus, hostNotFound, everConnected)}
          live
        >
          {describeConnStatus(connStatus, hostNotFound, everConnected)}
        </StatusIndicator>
        <DiagnosticsRow>
          <DiagnosticsButton type="button" onClick={onDownloadLogs}>
            Download logs
          </DiagnosticsButton>
        </DiagnosticsRow>
      </ConnectBox>
    </ConnectLayout>
  );
}

export function describeConnStatus(
  status: StationConnStatus,
  hostNotFound: boolean,
  everConnected: boolean,
): string {
  if (hostNotFound) {
    return everConnected
      ? "Host reconnecting — waiting for the main screen to come back…"
      : "Broker doesn't know that code. Retrying in case it comes back…";
  }
  switch (status) {
    case "idle":
      return "Waiting for a host ID.";
    case "connecting":
      return "Reaching the broker and opening a peer channel…";
    case "connected":
      return "Connected.";
    case "reconnecting":
      return "Reconnecting — the host or broker may be briefly unavailable.";
    case "disconnected":
      return "No connection. Use Download logs if this persists.";
  }
}

export function statusTone(
  status: StationConnStatus,
  hostNotFound: boolean,
  everConnected: boolean,
): "neutral" | "info" | "go" | "nogo" {
  // A reclaim window (previously connected) is a transient "info" state, not
  // the hard "nogo" of a wrong/dead code.
  if (hostNotFound) return everConnected ? "info" : "nogo";
  switch (status) {
    case "idle":
      return "neutral";
    case "connecting":
    case "reconnecting":
      return "info";
    case "connected":
      return "go";
    case "disconnected":
      return "nogo";
  }
}

const ConnectLayout = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  background: var(--color-surface-app);

  /* On a small phone the box should hug the viewport edges rather than
     sit in a centred card with wide outer gutters — combined with the
     ConnectBox padding reduction below this gives the form room to breathe
     on a 375px screen. */
  @media (max-width: 480px) {
    align-items: stretch;
    padding: calc(16px + env(safe-area-inset-top, 0px))
      calc(12px + env(safe-area-inset-right, 0px))
      calc(16px + env(safe-area-inset-bottom, 0px))
      calc(12px + env(safe-area-inset-left, 0px));
  }
`;

const ConnectBox = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: 40px 48px;
  max-width: 420px;
  width: 100%;
  color: var(--color-text-primary);

  h1 {
    margin: 0 0 8px;
    font-size: 20px;
    color: var(--color-text-primary);
  }

  p {
    margin: 0 0 20px;
    font-size: 13px;
    color: var(--color-text-muted);
  }

  @media (max-width: 480px) {
    padding: 20px 24px;
  }
`;

const Row = styled.div`
  display: flex;
  gap: 8px;

  /* Stack the input above the button on narrow screens so the connect
     control gets full width and isn't squeezed beside the wide host input. */
  @media (max-width: 480px) {
    flex-direction: column;
  }
`;

const HostInput = styled.input`
  flex: 1;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-text-faint);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 20px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-status-info-fg);

  &::placeholder {
    color: var(--color-text-faint);
    text-transform: none;
  }

  &:focus {
    outline: none;
    border-color: var(--color-status-info-fg);
  }

  /* Touch devices: comfortable tap target. */
  @media (pointer: coarse) {
    min-height: 44px;
  }
`;

const ConnectButton = styled.button`
  /* Give the button a visible fill + border so its affordance matches the
     input's visual weight — the old transparent-ish treatment read as a
     secondary link next to the prominent code field. */
  background: var(--color-status-info-bg);
  border: 1px solid var(--color-status-info-fg);
  border-radius: 4px;
  padding: 8px 20px;
  color: var(--color-status-info-fg);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-status-info-bg);
    border-color: var(--color-status-info-fg);
    filter: brightness(1.15);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Touch devices: comfortable tap target height. The button is already
     full-width on ≤480px phones via the stacked Row (flex column +
     align-items: stretch) — we deliberately do NOT force width:100% here
     because on a wider coarse-pointer device (landscape phone, tablet) the
     Row is still horizontal, and a full-width flex child would crush the
     host input beside it. Height-only keeps the 44px target everywhere
     without breaking the wide horizontal layout. */
  @media (pointer: coarse) {
    min-height: 44px;
  }
`;

const ErrorMsg = styled.p`
  margin-top: 12px !important;
  color: var(--color-status-nogo-fg) !important;
  font-size: 12px !important;
`;

const ReconnectMsg = styled.p`
  margin-top: 12px !important;
  color: var(--color-status-info-fg) !important;
  font-size: 12px !important;
`;

const DiagnosticsRow = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
`;

const DiagnosticsButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-text-faint);
  border-radius: 4px;
  padding: 4px 10px;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-text-muted);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    min-height: 44px;
  }
`;

const NameRow = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border-subtle);
`;
