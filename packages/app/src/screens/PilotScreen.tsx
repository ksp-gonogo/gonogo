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
import { MainScreen } from "./MainScreen";

const HOST_ID_KEY = "gonogo-station-host-id";

type ConnStatus = Parameters<
  Parameters<PeerClientService["onConnectionStatus"]>[0]
>[0];

/**
 * A pilot that joins mission control with its host code and reads the game
 * through it: the page at `/pilot/station`, and `/pilot` wherever the page
 * cannot open the mod's socket (any https page, such as the hosted site).
 *
 * The page never needs the mod's address and never hosts. The host serves it
 * from a mod session of its own that follows the active craft
 * (`SitrepVantageSessions`), carried over the peer link by `PeerTransport`.
 * The same link carries the shared thread and the roster. A pilot that can
 * reach the mod itself is a local screen (`LocalScreen`) and may host.
 *
 * The saved host code can be changed from the comms banner, which shows
 * whenever the link is down.

 * The link is not a gate on the page once it has been set up: a pilot is
 * flying either way, and losing mission control is a thing that happens to a
 * spacecraft rather than a reason to stop rendering the instruments.
 */
export function PilotScreen() {
  const [client] = useState(() => new PeerClientService({ seat: "pilot" }));
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [hostNotFound, setHostNotFound] = useState(false);
  const [brokerUnreachable, setBrokerUnreachable] = useState(false);
  const [brokerClosed, setBrokerClosed] = useState(false);
  const [hostChannelFailed, setHostChannelFailed] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [hostInput, setHostInput] = useState(
    () => localStorage.getItem(HOST_ID_KEY) ?? "",
  );
  const [codeCommitted, setCodeCommitted] = useState(
    () => !!localStorage.getItem(HOST_ID_KEY),
  );
  const [dismissed, setDismissed] = useState(false);
  const [changingCode, setChangingCode] = useState(false);
  const unsubs = useRef<Array<() => void>>([]);

  useEffect(() => {
    document.title = "gonogo - Pilot";
  }, []);

  useEffect(() => {
    logger.setIdentity({ role: "pilot" });
  }, []);

  useFollowHostAnalytics(client);

  const connect = (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    localStorage.setItem(HOST_ID_KEY, trimmed);
    setHostInput(trimmed);
    setCodeCommitted(true);
    setChangingCode(false);
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
    client.connect(trimmed);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; re-running would restart the connection on every render
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const fromUrl = params.get("host");
    const initial = fromUrl ?? localStorage.getItem(HOST_ID_KEY);
    if (initial) connect(initial);
    return () => {
      for (const u of unsubs.current) u();
      unsubs.current = [];
      /*
       * The CONNECTION as well as the listeners, which `StationScreen`'s own
       * teardown has always done and this one did not: dropping the callbacks
       * leaves a live peer holding a data channel nobody reads, and the host
       * goes on counting it. A remount then leaves the host with two
       * connections to one pilot and it sends everything twice, which the text
       * log hides (a message is deduped on its id) and the radio does not: a
       * chunk has no id and the far end decodes both copies, so the operator
       * hears a stutter.
       *
       * Found by the two-screen radio scene, where a pilot's every chunk
       * arrived exactly twice.
       */
      client.disconnect();
    };
  }, []);

  const [relayedTransport] = useState(() => new PeerTransport(client));

  const connected = status === "connected";
  // No code submitted yet, or a saved code being replaced: the operator is
  // asked for a code. Typing into the field is not submitting it. This is setup,
  // not a connection failure, and it is the only state that takes the whole
  // screen.
  const needsFirstSetup = (!codeCommitted && !everConnected) || changingCode;

  if (needsFirstSetup) {
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
          onConnect={connect}
          onDownloadLogs={() => logger.exportLogs()}
          nameEditor={<StationNameEditor />}
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
         * prop rather than inferring it. Until this landed, the only mount of
         * that component was `StationScreen`'s, hardcoded to
         * `"mission-control"`, so every peer the host knew about claimed to be
         * at a command centre and a pilot was indistinguishable from one.
         */}
        <StationInfoBroadcaster client={client} seat="pilot" />
        <StationSupersededNotice client={client} />
        <StationApprovalNotice client={client} />
        {!connected && !dismissed && (
          <PilotScreen__CommsBanner role="status" aria-live="polite">
            <Text size="xs" tone="warn">
              {hostNotFound
                ? `No mission control answering on ${hostInput}`
                : `Reaching mission control (${hostInput}): ${status}`}
            </Text>
            <Button onClick={() => connect(hostInput)}>Retry</Button>
            <Button onClick={() => setChangingCode(true)}>Change code</Button>
            <Button onClick={() => setDismissed(true)}>Dismiss</Button>
          </PilotScreen__CommsBanner>
        )}
        <MainScreen
          screen="pilot"
          hosting={false}
          hostLink={client}
          transport={relayedTransport}
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
