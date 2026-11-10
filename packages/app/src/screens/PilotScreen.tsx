import { logger } from "@ksp-gonogo/logger";
import { StationConnectView } from "@ksp-gonogo/ui";
import { Button, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { pageCounter } from "../analytics/pageCounts";
import { useFollowHostAnalytics } from "../analytics/useFollowHostAnalytics";
import { StationSupersededNotice } from "../components/StationSupersededNotice";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientService } from "../peer/PeerClientService";
import { StationInfoBroadcaster } from "../peer/StationInfoBroadcaster";
import { StationApprovalNotice } from "../stationApproval/StationApprovalNotice";
import { ScopedStationIdentity, StationNameEditor } from "../stationIdentity";
import { PeerTransport } from "../telemetry/PeerTransport";
import { useStationBrokers } from "../uplinks/useStationBrokers";
import { JoinWaiting } from "./JoinWaiting";
import { MainScreen } from "./MainScreen";
import { joinPath, normaliseCode, setJoined } from "./seatChoice";

type ConnStatus = Parameters<
  Parameters<PeerClientService["onConnectionStatus"]>[0]
>[0];

/**
 * A pilot that joined the game under `code` from the join page and reads it
 * through the host. The host serves it from a mod session of its own that
 * follows the active craft (`SitrepVantageSessions`), carried over the peer
 * link by `PeerTransport`. The same link carries the shared thread and the
 * roster.
 *
 * Until the host first approves it the page waits on the join view. After
 * that the link is not a gate on the page: a pilot is flying either way, and
 * losing mission control is a thing that happens to a spacecraft rather than
 * a reason to stop rendering the instruments.
 */
export function PilotScreen({ code }: { code: string }) {
  const [client] = useState(() => new PeerClientService({ seat: "pilot" }));
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [hostNotFound, setHostNotFound] = useState(false);
  const [brokerUnreachable, setBrokerUnreachable] = useState(false);
  const [brokerClosed, setBrokerClosed] = useState(false);
  const [hostChannelFailed, setHostChannelFailed] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [approval, setApproval] = useState(() => client.getApproval());
  const [everApproved, setEverApproved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hostInput, setHostInput] = useState(code);
  const unsubs = useRef<Array<() => void>>([]);

  useEffect(() => {
    document.title = "gonogo - Pilot";
  }, []);

  useEffect(() => {
    logger.setIdentity({ role: "pilot" });
  }, []);

  useEffect(() => {
    setApproval(client.getApproval());
    return client.onApprovalChange((next) => {
      setApproval(next);
      if (next === "approved") setEverApproved(true);
    });
  }, [client]);

  useFollowHostAnalytics(client);
  useStationBrokers(client);

  const connect = () => {
    setDismissed(false);
    for (const u of unsubs.current) u();
    unsubs.current = [];
    setHostNotFound(false);
    unsubs.current.push(
      client.onConnectionStatus((s) => {
        setStatus(s);
        if (s === "connected") {
          setHostNotFound(false);
          setEverConnected(true);
          pageCounter().event("pilot-joined");
        }
      }),
      client.onHostUnavailable(() => setHostNotFound(true)),
      client.onBrokerReachable((reachable) => setBrokerUnreachable(!reachable)),
      client.onBrokerClosed(setBrokerClosed),
      client.onHostChannelFailed(setHostChannelFailed),
    );
    client.connect(code);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; re-running would restart the connection on every render
  useEffect(() => {
    connect();
    return () => {
      for (const u of unsubs.current) u();
      unsubs.current = [];
      /*
       * The CONNECTION as well as the listeners: dropping the callbacks leaves
       * a live peer holding a data channel nobody reads, and the host goes on
       * counting it. A remount then leaves the host with two connections to
       * one pilot and it sends everything twice, which the text log hides (a
       * message is deduped on its id) and the radio does not: a chunk has no
       * id and the far end decodes both copies, so the operator hears a
       * stutter.
       */
      client.disconnect();
    };
  }, []);

  const [relayedTransport] = useState(() => new PeerTransport(client));

  const connected = status === "connected";
  const failed =
    hostNotFound || brokerUnreachable || brokerClosed || hostChannelFailed;

  if (!everApproved) {
    if (failed && !everConnected) {
      return (
        <ScopedStationIdentity defaultName="Pilot">
          <StationConnectView
            hostInput={hostInput}
            connStatus={status}
            hostNotFound={hostNotFound}
            brokerUnreachable={brokerUnreachable}
            brokerClosed={brokerClosed}
            hostChannelFailed={hostChannelFailed}
            everConnected={everConnected}
            onHostInputChange={setHostInput}
            onConnect={(next) => {
              const typed = normaliseCode(next);
              if (typed && typed !== code) {
                setJoined(null);
                globalThis.location.assign(joinPath(typed));
                return;
              }
              connect();
            }}
            onDownloadLogs={() => logger.exportLogs()}
            nameEditor={<StationNameEditor />}
          />
        </ScopedStationIdentity>
      );
    }
    return (
      <ScopedStationIdentity defaultName="Pilot">
        <StationInfoBroadcaster client={client} seat="pilot" />
        <StationSupersededNotice client={client} />
        <JoinWaiting
          code={code}
          phase={
            approval === "refused"
              ? "refused"
              : connected && approval === "pending"
                ? "pending"
                : "reaching"
          }
          onAskAgain={() => client.askAgain()}
        />
      </ScopedStationIdentity>
    );
  }

  return (
    <ScopedStationIdentity defaultName="Pilot">
      <PeerClientProvider client={client}>
        {/*
         * Tells the host a PILOT is on the link, not another mission-control
         * screen. Nothing else can say it: the seat is known only to the peer
         * sitting at it, which is why `StationInfoBroadcaster` takes it as a
         * prop rather than inferring it.
         */}
        <StationInfoBroadcaster client={client} seat="pilot" />
        <StationSupersededNotice client={client} />
        <StationApprovalNotice client={client} />
        {!connected && !dismissed && (
          <PilotScreen__CommsBanner role="status" aria-live="polite">
            <Text size="xs" tone="warn">
              {hostNotFound
                ? `No host answering on ${code}`
                : `Reaching the host (${code}): ${status}`}
            </Text>
            <Button onClick={connect}>Retry</Button>
            <Button onClick={() => setDismissed(true)}>Dismiss</Button>
          </PilotScreen__CommsBanner>
        )}
        <MainScreen
          screen="pilot"
          hosting={false}
          hostLink={client}
          transport={relayedTransport}
          inviteCode={code}
        />
      </PeerClientProvider>
    </ScopedStationIdentity>
  );
}

/**
 * Non-blocking, because the instruments are not the mesh's to gate. It says
 * which host is not answering rather than only that something is wrong: a
 * pilot who cannot reach the ground still needs to know which ground.
 */
const PilotScreen__CommsBanner = styled.div`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-warn-mark);
  border-top: none;
  border-radius: 0 0 var(--radius-regular) var(--radius-regular);
`;
