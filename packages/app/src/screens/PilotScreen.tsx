import { StationConnectView } from "@ksp-gonogo/components";
import { logger } from "@ksp-gonogo/logger";
import { Button, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientService } from "../peer/PeerClientService";
import { ScopedStationIdentity, StationNameEditor } from "../stationIdentity";
import { MainScreen } from "./MainScreen";

const HOST_ID_KEY = "gonogo-station-host-id";

type ConnStatus = Parameters<
  Parameters<PeerClientService["onConnectionStatus"]>[0]
>[0];

/**
 * The pilot's page: a human aboard the craft.
 *
 * Its whole shape follows from separating two planes the rest of the app runs
 * together:
 *
 *   - the OBSERVATION plane is a `TelemetryClient` over a transport. A pilot
 *     holds its own `WebSocketTransport` straight to the mod, so it has its own
 *     session and therefore its own vantage. `MainScreen` builds that itself
 *     when handed no transport, which is why this route renders `MainScreen`
 *     rather than forking it
 *   - the COORDINATION plane is the PeerJS mesh: the shared thread, notes,
 *     alarms, GO/NO-GO, the roster. A pilot joins it as a CLIENT
 *
 * A station happens to use the mesh for both, which is why the two read as one
 * thing. They are not, and a pilot is the case that separates them: direct-WS
 * on one plane and a peer on the other. Rendering `/pilot` outside a peer
 * provider would give it its own vantage and make it not a peer at all, so it
 * would never send `station-info`, never join the roster, and could not reach
 * the thread.
 *
 * The mesh is NOT a gate on the page. A station blocks until it is connected
 * because it has nothing to show otherwise; a pilot is flying either way, and
 * losing mission control is a thing that happens to a spacecraft rather than a
 * reason to stop rendering the instruments.
 */
export function PilotScreen() {
  const [client] = useState(() => new PeerClientService());
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [hostNotFound, setHostNotFound] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [hostInput, setHostInput] = useState(
    () => localStorage.getItem(HOST_ID_KEY) ?? "",
  );
  const [dismissed, setDismissed] = useState(false);
  const unsubs = useRef<Array<() => void>>([]);

  useEffect(() => {
    document.title = "gonogo - Pilot";
  }, []);

  useEffect(() => {
    logger.setIdentity({ role: "pilot" });
  }, []);

  const connect = (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    localStorage.setItem(HOST_ID_KEY, trimmed);
    setHostInput(trimmed);
    for (const u of unsubs.current) u();
    unsubs.current = [];
    setHostNotFound(false);
    unsubs.current.push(
      client.onConnectionStatus((s) => {
        setStatus(s);
        if (s === "connected") {
          setHostNotFound(false);
          setEverConnected(true);
        }
      }),
      client.onHostUnavailable(() => setHostNotFound(true)),
    );
    client.connect(trimmed);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; re-running would restart the connection on every render
  useEffect(() => {
    const fromUrl = new URLSearchParams(globalThis.location.search).get("host");
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

  const connected = status === "connected";
  // Nothing saved and nothing tried: the operator has to be asked once. This
  // is setup, not a connection failure, and it is the only state that takes
  // the whole screen.
  const needsFirstSetup = !hostInput && !everConnected;

  if (needsFirstSetup) {
    return (
      <ScopedStationIdentity defaultName="Pilot">
        <StationConnectView
          hostInput={hostInput}
          connStatus={status}
          hostNotFound={hostNotFound}
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
    <PeerClientProvider client={client}>
      {!connected && !dismissed && (
        <PilotScreen__CommsBanner role="status" aria-live="polite">
          <Text size="xs" tone="warn">
            {hostNotFound
              ? `No mission control answering on ${hostInput}`
              : `Reaching mission control (${hostInput}): ${status}`}
          </Text>
          <Button onClick={() => connect(hostInput)}>Retry</Button>
          <Button onClick={() => setDismissed(true)}>Dismiss</Button>
        </PilotScreen__CommsBanner>
      )}
      <MainScreen screen="pilot" />
    </PeerClientProvider>
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
  gap: var(--space-8);
  padding: var(--space-4) var(--space-12);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-status-warning-bg);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
`;
