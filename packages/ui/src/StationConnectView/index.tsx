/**
 * The station's presentational "Connect to Mission Control" screen, driven through the render harness at mobile breakpoints with the same markup production uses.
 * The name editor and download-logs action arrive as slots and all state as props, so it carries no `@ksp-gonogo/app` dependency.
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useState } from "react";
import { StatusIndicator } from "../StatusIndicator";
import {
  CONNECT_STALL_MS,
  type ConnectProgress,
  describeConnStatus,
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
  /** The broker answered this browser, then closed its connection: the device is online, and the broker refused what the station sent it. */
  brokerClosed?: boolean;
  /** The station stopped retrying: the broker answered but the main screen's data channel never opened, so the two devices have no direct path. Connecting again starts a fresh set of attempts. */
  hostChannelFailed?: boolean;
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
  brokerClosed = false,
  hostChannelFailed = false,
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
    !brokerClosed &&
    !hostNotFound &&
    !hostChannelFailed &&
    now - progress.startedAt >= CONNECT_STALL_MS;
  return (
    <ConnectLayout as="main" aria-label="Connect to mission control">
      <ConnectBox>
        <h1>Connect to Mission Control</h1>
        <p>Enter the join code shown on the main screen.</p>
        <ConnectRow>
          <HostInput
            value={hostInput}
            onChange={(e) => onHostInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConnect(hostInput)}
            placeholder="e.g. AB3KP7"
            maxLength={8}
            aria-label="Join code"
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
        {!brokerUnreachable && brokerClosed && (
          <ErrorMsg role="alert">
            Connection closed by peer broker service.
            {hostChannelFailed
              ? " Press Connect to try again."
              : " Retrying..."}
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
            Couldn't find join code &ldquo;{hostInput.trim().toUpperCase()}
            &rdquo;. The main screen may not be ready yet: it may still be
            starting, or waiting for an answer to its start-up questions, or its
            tab may be closed or asleep. Check the join code matches the main
            screen. This station keeps trying.
          </ErrorMsg>
        )}
        {!brokerUnreachable &&
          !brokerClosed &&
          !hostNotFound &&
          hostChannelFailed && (
            <ErrorMsg role="alert">
              Couldn&apos;t reach the main screen. Check that it is open, then
              press Connect to try again.
            </ErrorMsg>
          )}
        {!brokerUnreachable &&
          !brokerClosed &&
          !hostNotFound &&
          !hostChannelFailed &&
          connStatus === "disconnected" && (
            <ErrorMsg>
              Connection lost. Check the join code and try again.
            </ErrorMsg>
          )}
        {stalled && progress && (
          <ErrorMsg role="alert">
            No connection after <Seconds ms={now - progress.startedAt} />. Still
            trying in the background.
          </ErrorMsg>
        )}
        <StatusSlot>
          <StatusIndicator
            tone={statusTone(
              connStatus,
              hostNotFound,
              everConnected,
              brokerUnreachable,
              brokerClosed,
            )}
            live
          >
            {describeConnStatus(
              connStatus,
              hostNotFound,
              everConnected,
              brokerUnreachable,
              brokerClosed,
            )}
          </StatusIndicator>
        </StatusSlot>
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
