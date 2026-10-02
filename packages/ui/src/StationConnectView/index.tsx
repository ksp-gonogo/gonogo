/**
 * The station's presentational "Connect to Mission Control" screen, driven through the render harness at mobile breakpoints with the same markup production uses.
 * The name editor and download-logs action arrive as slots and all state as props, so it carries no `@ksp-gonogo/app` dependency.
 */

import type { ReactNode } from "react";
import { StatusIndicator } from "../StatusIndicator";
import {
  describeConnStatus,
  type StationConnStatus,
  statusTone,
} from "./connStatus";
import {
  ConnectBox,
  ConnectButton,
  ConnectLayout,
  ConnectRow,
  DiagnosticsButton,
  DiagnosticsRow,
  ErrorMsg,
  HostInput,
  NameRow,
  ReconnectMsg,
} from "./StationConnectView.styles";

export {
  describeConnStatus,
  type StationConnStatus,
  statusTone,
} from "./connStatus";

export interface StationConnectViewProps {
  /** Current value of the host-code input. */
  hostInput: string;
  /** Live connection status from the peer client. */
  connStatus: StationConnStatus;
  /** Broker couldn't resolve the code on the most recent attempt. */
  hostNotFound: boolean;
  /** This browser cannot reach the PeerJS broker at all: unlike `hostNotFound`, nothing about the code is wrong, and the device has no route to the service both ends meet on. */
  brokerUnreachable?: boolean;
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
  brokerUnreachable = false,
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
        <p>Enter the host ID shown on the main screen.</p>
        <ConnectRow>
          <HostInput
            value={hostInput}
            onChange={(e) => onHostInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConnect(hostInput)}
            placeholder="e.g. AB3KP7"
            maxLength={8}
            aria-label="Host ID"
            autoFocus
          />
          <ConnectButton
            type="button"
            onClick={() => onConnect(hostInput)}
            disabled={connStatus === "connecting"}
          >
            {connStatus === "connecting" ? "Connecting..." : "Connect"}
          </ConnectButton>
        </ConnectRow>
        {nameEditor && <NameRow>{nameEditor}</NameRow>}
        {brokerUnreachable && (
          <ErrorMsg>
            Can&apos;t reach the peer broker. This device joins through an
            internet service, so it needs a working internet connection even
            when the main screen is on the same WiFi. Check that this device is
            online and that the network allows outbound HTTPS.
          </ErrorMsg>
        )}
        {!brokerUnreachable && hostNotFound && everConnected && (
          <ReconnectMsg role="status" aria-live="polite">
            Host reconnecting... The main screen is restarting and will be back
            shortly: this station reconnects automatically.
          </ReconnectMsg>
        )}
        {!brokerUnreachable && hostNotFound && !everConnected && (
          <ErrorMsg>
            Couldn't find code &ldquo;{hostInput.trim().toUpperCase()}&rdquo;.
            Check the main screen: the code may have changed, or the main-screen
            tab may be closed/asleep.
          </ErrorMsg>
        )}
        {!brokerUnreachable &&
          !hostNotFound &&
          connStatus === "disconnected" && (
            <ErrorMsg>
              Connection lost. Check the host ID and try again.
            </ErrorMsg>
          )}
        <StatusIndicator
          tone={statusTone(
            connStatus,
            hostNotFound,
            everConnected,
            brokerUnreachable,
          )}
          live
        >
          {describeConnStatus(
            connStatus,
            hostNotFound,
            everConnected,
            brokerUnreachable,
          )}
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
