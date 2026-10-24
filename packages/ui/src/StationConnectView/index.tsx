/**
 * The station's presentational "Connect to Mission Control" screen, driven through the render harness at mobile breakpoints with the same markup production uses.
 * The name editor and download-logs action arrive as slots and all state as props, so it carries no `@ksp-gonogo/app` dependency.
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { LiveRegion, Unit } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useState } from "react";
import { StatusIndicator } from "../StatusIndicator";
import {
  CONNECT_STALL_MS,
  type ConnectProgress,
  describeConnStatus,
  describeRelayStage,
  type StationConnStatus,
  stageStates,
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
  RelayStage,
  StageList,
  StageSlot,
  StatusSlot,
} from "./StationConnectView.styles";

export {
  CONNECT_STALL_MS,
  type ConnectProgress,
  type ConnectStage,
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
  /** The station stopped retrying: the broker answered but the main screen's data channel never opened, so the two devices have no direct path. Connecting again starts a fresh set of attempts. */
  hostChannelFailed?: boolean;
  /** What the relay named in the station's link did. `none`: the link names no relay. `unreachable`: it was named and could not be fetched from. `used`: its relay entries were in the station's ICE config. */
  relayLookup?: "none" | "pending" | "used" | "unreachable";
  /** This station reached "connected" at least once this session. */
  everConnected: boolean;
  /** Fired on every keystroke in the host-code input. */
  onHostInputChange: (value: string) => void;
  /** Fired when the user submits a code (button click or Enter). */
  onConnect: (hostId: string) => void;
  /** Fired when the user taps "Download logs". */
  onDownloadLogs: () => void;
  /** Facts about the connect in flight; absent until a connect begins. */
  progress?: ConnectProgress;
  /** Slot for the app-scoped station-name editor (needs React context). */
  nameEditor?: ReactNode;
}

export function StationConnectView({
  hostInput,
  connStatus,
  hostNotFound,
  brokerUnreachable = false,
  hostChannelFailed = false,
  relayLookup = "none",
  everConnected,
  onHostInputChange,
  onConnect,
  onDownloadLogs,
  progress,
  nameEditor,
}: StationConnectViewProps) {
  const waiting = connStatus === "connecting" || connStatus === "reconnecting";
  const now = useNow(
    (waiting || connStatus === "connected") && progress !== undefined,
  );
  const stalled =
    waiting &&
    progress !== undefined &&
    !brokerUnreachable &&
    !hostNotFound &&
    !hostChannelFailed &&
    now - progress.startedAt >= CONNECT_STALL_MS;
  const relayStage = describeRelayStage(
    connStatus,
    progress,
    now,
    relayLookup === "used",
  );
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
            disabled={connStatus === "connecting" && !stalled}
          >
            {connStatus === "connecting" && !stalled
              ? "Connecting..."
              : "Connect"}
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
          <ReconnectMsg>
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
        {!brokerUnreachable && !hostNotFound && hostChannelFailed && (
          <ErrorMsg role="alert">
            {relayLookup === "unreachable" ? (
              <>
                Couldn&apos;t reach the main screen directly, and the relay in
                this link did not answer. Check that the relay is running and
                reachable from this network, then press Connect to try again.
              </>
            ) : relayLookup === "used" ? (
              <>
                Couldn&apos;t reach the main screen, even through the relay in
                this link. Check that the main screen is open and its relay
                ports are forwarded, then press Connect to try again.
              </>
            ) : (
              <>
                Couldn&apos;t reach the main screen directly, and this link
                names no relay. Move this device onto the same network as the
                main screen, or open the link from the Add station panel once
                its relay check passes, then press Connect to try again.
              </>
            )}
          </ErrorMsg>
        )}
        {!brokerUnreachable &&
          !hostNotFound &&
          !hostChannelFailed &&
          connStatus === "disconnected" && (
            <ErrorMsg>
              Connection lost. Check the host ID and try again.
            </ErrorMsg>
          )}
        {stalled && progress && (
          <ErrorMsg role="alert">
            No connection after <Seconds ms={now - progress.startedAt} />. Still
            trying in the background.
          </ErrorMsg>
        )}
        <StatusSlot>
          {!(relayStage && connStatus === "reconnecting") && (
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
          )}
        </StatusSlot>
        <RelayStage>
          <LiveRegion as="span">{relayStage}</LiveRegion>
          {relayStage && waiting && progress?.entered.host !== undefined && (
            <>
              {" "}
              <Seconds ms={now - progress.startedAt} />
            </>
          )}
        </RelayStage>
        <StageSlot>
          {waiting && progress && progress.attempt > 0 && (
            <ProgressList progress={progress} now={now} />
          )}
        </StageSlot>
        <DiagnosticsRow>
          <DiagnosticsButton type="button" onClick={onDownloadLogs}>
            Download logs
          </DiagnosticsButton>
        </DiagnosticsRow>
      </ConnectBox>
    </ConnectLayout>
  );
}

/** Epoch ms, refreshed each second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

function ProgressList({
  progress,
  now,
}: Readonly<{ progress: ConnectProgress; now: number }>) {
  const rows = stageStates(progress);
  return (
    <StageList aria-label="Connection stages">
      {rows.map(({ stage, label, state }, i) => {
        const began = progress.entered[stage];
        const next = rows[i + 1]?.stage;
        const ended = next ? progress.entered[next] : undefined;
        return (
          <li key={stage} data-state={state}>
            <span>{label}</span>
            <span>
              {state === "done" &&
              began !== undefined &&
              ended !== undefined ? (
                <>
                  ok, <Seconds ms={ended - began} />
                </>
              ) : state === "active" && began !== undefined ? (
                <>
                  waiting, <Seconds ms={now - began} />
                </>
              ) : (
                "not started"
              )}
            </span>
          </li>
        );
      })}
      <li>
        <span>Elapsed</span>
        <span>
          <Seconds ms={now - progress.startedAt} />, attempt {progress.attempt}
        </span>
      </li>
    </StageList>
  );
}

function Seconds({ ms }: Readonly<{ ms: number }>) {
  return <Unit value={value("irl:s", Math.max(0, ms) / 1000)} />;
}
