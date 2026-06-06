import { ManeuverTriggerProvider } from "@gonogo/components";
import {
  getDataSource,
  KosProxyContext,
  registerDataSource,
  type SCANType,
  ScreenProvider,
} from "@gonogo/core";
import {
  CpuRegistryProvider,
  CpuRegistryService,
  DEFAULT_PROFILE_ID,
  FlightsFab,
  FogMaskCacheProvider,
  FogMaskStore,
} from "@gonogo/data";
import type { KerbcamDataSource } from "@gonogo/kerbcam";
import { debugPeer, logger } from "@gonogo/logger";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialPortRecoveryWatcher,
} from "@gonogo/serial";
import { BannerStack, FabClusterProvider, StatusIndicator } from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  AlarmClientService,
  type AlarmSnapshot,
  AlarmsFab,
  AlarmsLauncherBridge,
  AlarmsModal,
  StationAlarmBanner,
} from "../alarms";
import { createBrowserConsentController } from "../analytics/axiomTransportFactory";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";
import type { DashboardConfig } from "../components/Dashboard";
import { Dashboard } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";
import { FlightOutcomeBanner } from "../components/FlightOutcomeBanner";
import { FullscreenFab } from "../components/FullscreenFab";
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { StationConnectionFab } from "../components/StationConnectionFab";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";
import { TelemachusAntennaBanner } from "../components/TelemachusAntennaBanner";
import { downloadLogs } from "../logs/downloadLogs";
import { ManeuverTriggerClientService } from "../maneuverTriggers";
import {
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
  SceneSwitchPrompt,
} from "../missionProfiles";
import { HostDisconnectBanner } from "../peer/HostDisconnectBanner";
import { HostVersionBanner } from "../peer/HostVersionBanner";
import { KosPeerConnection } from "../peer/KosPeerConnection";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { ConnStatus } from "../peer/PeerClientService";
import { PeerClientService } from "../peer/PeerClientService";
import { PushClientProvider } from "../pushToMain/PushClientContext";
import {
  SettingsFab,
  SettingsProvider,
  SettingsService,
  useStationWakeLock,
} from "../settings";
import {
  ScopedStationIdentity,
  StationNameEditor,
  useStationName,
} from "../stationIdentity";
import { BUILD_TIME, VERSION } from "../version";

const HOST_ID_KEY = "gonogo-station-host-id";

const DEFAULT_CONFIG: DashboardConfig = {
  items: [],
  layouts: {},
};

export function StationScreen() {
  useEffect(() => {
    document.title = "gonogo — Station";
  }, []);
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [hostNotFound, setHostNotFound] = useState(false);
  const [hostInput, setHostInput] = useState(
    localStorage.getItem(HOST_ID_KEY) ?? "",
  );
  const [client] = useState(() => new PeerClientService());
  // True once this station has reached "connected" at least once this
  // session. Lets the connect screen tell "host mid-reclaim after a restart"
  // (previously connected → show "Host reconnecting…") apart from "wrong
  // code / host never up" (never connected → "couldn't find that code"). On
  // the wire both look like the same `peer-unavailable`.
  const [everConnected, setEverConnected] = useState(false);
  const dashboard = useDashboardState(
    "gonogo:dashboard:station",
    DEFAULT_CONFIG,
  );
  const [serialService] = useState(
    () => new SerialDeviceService({ screenKey: "station" }),
  );
  const [settingsService] = useState(() => new SettingsService());
  const [missionProfiles] = useState(
    () => new MissionProfilesService("station"),
  );
  const [cpuRegistry] = useState(() => new CpuRegistryService("station"));
  const [alarmClient] = useState(() => new AlarmClientService(client));
  const [maneuverTriggerClient] = useState(
    () => new ManeuverTriggerClientService(client),
  );
  const [_alarmSnapshot, setAlarmSnapshot] = useState<AlarmSnapshot>(
    alarmClient.snapshot(),
  );
  useEffect(() => alarmClient.subscribe(setAlarmSnapshot), [alarmClient]);
  // Stable hook the AlarmsFab/Modal can call from inside its own render
  // tree to subscribe to live alarm snapshots. Capturing a snapshot at
  // open() time made the second alarm in a session anchor to a stale UT.
  const useStationAlarmSnapshot = useMemo(
    () => () => {
      // biome-ignore lint/correctness/useHookAtTopLevel: defining a hook
      const [snap, setSnap] = useState<AlarmSnapshot>(() =>
        alarmClient.snapshot(),
      );
      // biome-ignore lint/correctness/useHookAtTopLevel: defining a hook
      useEffect(() => alarmClient.subscribe(setSnap), []);
      return snap;
    },
    [alarmClient],
  );
  const [fogMaskStore] = useState(() => new FogMaskStore());
  const unsubsRef = useRef<Array<() => void>>([]);
  const schemaHandledRef = useRef(false);

  useEffect(() => {
    const dispatcher = new InputDispatcher({
      service: serialService,
      getItems: dashboard.getItems,
    });
    return () => {
      dispatcher.dispose();
    };
  }, [serialService, dashboard.getItems]);

  useEffect(() => {
    // Reopen previously-authorised serial ports (no user prompt). Covers the
    // "auto-reconnect on station refresh" live-test bug. Also re-attach the
    // hot-plug listeners — destroy() detaches them, so a StrictMode
    // cleanup→setup cycle would otherwise silently kill hot-plug for the
    // rest of the page lifetime.
    serialService.attachNavigatorListeners();
    void serialService.autoReconnect();
    return () => {
      // Detach navigator.serial listeners + tear down transports on unmount.
      void serialService.destroy();
    };
  }, [serialService]);

  // Gate this station's Axiom transport on the HOST's analytics consent.
  // Stations never read a local consent value — they follow the host. The
  // controller defaults removed (disabled); onAnalyticsConsent fires
  // immediately with the cached value and again on every host broadcast.
  // On unmount we apply(false) so a remount starts clean and so a
  // disconnected station doesn't keep shipping under a stale grant.
  useEffect(() => {
    const controller = createBrowserConsentController();
    const unsub = client.onAnalyticsConsent((enabled) => {
      controller.apply(enabled);
    });
    return () => {
      unsub();
      controller.apply(false);
    };
  }, [client]);

  // Switch the globally-registered kerbcam source into brokered (station) mode:
  // its WebRTC handshake relays through the host (no sidecar address) and its
  // TURN creds come from the host's relay broadcast. Wired here once — it stays
  // disconnected until a camera widget asks for a stream (lazy connect), and
  // the broker's negotiate just retries until the host link is up. Media flows
  // station↔sidecar directly off the answer's ICE candidates, never via PeerJS.
  useEffect(() => {
    const kerbcam = getDataSource("kerbcam") as KerbcamDataSource | undefined;
    kerbcam?.attachBroker({
      negotiate: (offer) => client.sendKerbcamNegotiate(offer),
      iceServers: () => client.getRelayIceServers(),
      onIceServersChange: (cb) => client.onRelayIceServersChange(cb),
    });
  }, [client]);

  function attemptConnect(hostId: string) {
    const trimmed = hostId.trim().toUpperCase();
    if (!trimmed) return;
    localStorage.setItem(HOST_ID_KEY, trimmed);
    // Keep the input state in sync so the StationConnectionFab can read
    // the live host code even when auto-connect from `?host=` skipped
    // typing it into the form.
    setHostInput(trimmed);

    debugPeer("StationScreen attemptConnect", {
      host: trimmed,
      listenerCountsBefore: client._listenerCounts(),
    });

    // Drain any prior listeners before (re)registering — otherwise listener
    // Sets on the client grow on every retry / StrictMode cycle.
    unsubsRef.current.forEach((u) => {
      u();
    });
    unsubsRef.current = [];
    schemaHandledRef.current = false;

    setHostNotFound(false);
    unsubsRef.current.push(
      client.onConnectionStatus((s) => {
        setConnStatus(s);
        // A live connection clears the "not found" badge — the most
        // recent attempt for this host succeeded.
        if (s === "connected") {
          setHostNotFound(false);
          setEverConnected(true);
        }
      }),
    );
    unsubsRef.current.push(
      client.onHostUnavailable(() => {
        setHostNotFound(true);
      }),
    );
    // `HOST_ID_KEY` holds the stable share-code. The host's broker peer id
    // is derived from it (`gonogo-host-<code>`) and never changes for a
    // given code, so a refresh re-derives the same target — no persistence
    // of any ephemeral id is needed here.

    // One-shot fog snapshot from the host. Persist each mask to the
    // station's local FogMaskStore — the map widget reads through the
    // same store so a refresh shows the host's exploration state. Both
    // sides bucket under DEFAULT_PROFILE_ID now that save-profile
    // scoping has been removed.
    unsubsRef.current.push(
      client.onFogSnapshot((msg) => {
        logger.info(`[fog-sync] snapshot received — masks=${msg.masks.length}`);
        for (const m of msg.masks) {
          // Per-type mask routing: each mask carries its scanType (SCANsat's
          // SCANtype enum bit). The station persists each into its own
          // per-type slot so the local MapView composes the same per-channel
          // precedence the host renders.
          fogMaskStore
            .save(
              DEFAULT_PROFILE_ID,
              m.bodyId,
              m.scanType as SCANType,
              m.data,
              m.width,
              m.height,
            )
            .catch((err) => {
              logger.error(
                `[fog-sync] failed to persist mask — body=${m.bodyId} scanType=${m.scanType}`,
                err instanceof Error ? err : undefined,
              );
            });
        }
      }),
    );
    unsubsRef.current.push(
      client.onSchema((sources) => {
        if (schemaHandledRef.current) return;
        schemaHandledRef.current = true;
        for (const s of sources) {
          // kerbcam is NOT peer-routed: its media streams direct from the
          // sidecar, brokered through the host. Don't replace the real
          // (brokered) source with a peer-data one — it's wired in the
          // attachBroker mount effect, and connects lazily on first camera view.
          if (s.id === "kerbcam") continue;
          const source = new PeerClientDataSource(s.id, s.name, client);
          source.setSchema(s.keys);
          registerDataSource(source);
          void source.connect();
        }

        setConnected(true);
      }),
    );
    client.connect(trimmed);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — attemptConnect and client are captured once at mount; re-running would cause reconnect loops
  useEffect(() => {
    // QR-code / shared-link path: ?host=<peerId> in the URL takes
    // precedence over localStorage so a fresh device can land directly
    // on the right host without typing. Drop the param after consuming
    // it (history.replaceState) so a refresh doesn't keep a stale host
    // pinned in the URL bar — localStorage is the authoritative store
    // from the second load onwards.
    const params = new URLSearchParams(globalThis.location.search);
    const hostFromUrl = params.get("host");
    if (hostFromUrl) {
      const url = new URL(globalThis.location.href);
      url.searchParams.delete("host");
      globalThis.history.replaceState({}, "", url.toString());
    }
    const initialHost = hostFromUrl ?? localStorage.getItem(HOST_ID_KEY);
    if (initialHost) attemptConnect(initialHost);
    return () => {
      unsubsRef.current.forEach((u) => {
        u();
      });
      unsubsRef.current = [];
      client.disconnect();
    };
  }, []);

  const kosProxy = useMemo(
    () => ({
      createConnection: (params: {
        sessionId: string;
        kosHost: string;
        kosPort: number;
        cols: number;
        rows: number;
      }) => new KosPeerConnection(params.sessionId, client, params),
      resize: (sessionId: string, cols: number, rows: number) =>
        client.sendKosResize(sessionId, cols, rows),
    }),
    [client],
  );

  if (!connected) {
    return (
      <ScreenProvider value="station">
        <SettingsProvider service={settingsService}>
          <CpuRegistryProvider service={cpuRegistry}>
            <MissionProfilesProvider service={missionProfiles}>
              <ScopedStationIdentity>
                <ConnectLayout
                  as="main"
                  aria-label="Connect to mission control"
                >
                  <ConnectBox>
                    <h1>Connect to Mission Control</h1>
                    <p>
                      Enter the 4-character host ID shown on the main screen.
                    </p>
                    <Row>
                      <HostInput
                        value={hostInput}
                        onChange={(e) => setHostInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && attemptConnect(hostInput)
                        }
                        placeholder="e.g. AB3K"
                        maxLength={8}
                        autoFocus
                      />
                      <ConnectButton
                        onClick={() => attemptConnect(hostInput)}
                        disabled={connStatus === "connecting"}
                      >
                        {connStatus === "connecting"
                          ? "Connecting…"
                          : "Connect"}
                      </ConnectButton>
                    </Row>
                    <NameRow>
                      <StationNameEditor />
                    </NameRow>
                    {hostNotFound && everConnected && (
                      <ReconnectMsg role="status" aria-live="polite">
                        Host reconnecting… The main screen is restarting and
                        will be back shortly — this station reconnects
                        automatically.
                      </ReconnectMsg>
                    )}
                    {hostNotFound && !everConnected && (
                      <ErrorMsg>
                        Couldn't find code &ldquo;
                        {hostInput.trim().toUpperCase()}&rdquo;. Check the main
                        screen — the code may have changed, or the main-screen
                        tab may be closed/asleep.
                      </ErrorMsg>
                    )}
                    {!hostNotFound && connStatus === "disconnected" && (
                      <ErrorMsg>
                        Connection lost. Check the host ID and try again.
                      </ErrorMsg>
                    )}
                    <StatusIndicator
                      tone={statusTone(connStatus, hostNotFound, everConnected)}
                      live
                    >
                      {describeConnStatus(
                        connStatus,
                        hostNotFound,
                        everConnected,
                      )}
                    </StatusIndicator>
                    <DiagnosticsRow>
                      <DiagnosticsButton type="button" onClick={downloadLogs}>
                        Download logs
                      </DiagnosticsButton>
                    </DiagnosticsRow>
                  </ConnectBox>
                </ConnectLayout>
              </ScopedStationIdentity>
            </MissionProfilesProvider>
          </CpuRegistryProvider>
        </SettingsProvider>
      </ScreenProvider>
    );
  }

  return (
    <ScreenProvider value="station">
      <SettingsProvider service={settingsService}>
        <CpuRegistryProvider service={cpuRegistry}>
          <MissionProfilesProvider service={missionProfiles}>
            <StationWakeLockBridge />
            <ScopedStationIdentity>
              <StationInfoBroadcaster client={client} />
              <PeerClientProvider client={client}>
                <ManeuverTriggerProvider service={maneuverTriggerClient}>
                  <PushClientProvider>
                    <FogMaskCacheProvider store={fogMaskStore}>
                      <KosProxyContext.Provider value={kosProxy}>
                        <SerialDeviceProvider service={serialService}>
                          <OverlayProvider
                            addItem={dashboard.addItem}
                            updateItemConfig={dashboard.updateItemConfig}
                          >
                            <AlarmsLauncherBridge
                              useSnapshot={useStationAlarmSnapshot}
                              onAdd={(input) => alarmClient.addAlarm(input)}
                              onUpdate={(id, patch) =>
                                alarmClient.updateAlarm(id, patch)
                              }
                              onDelete={(id) => alarmClient.deleteAlarm(id)}
                            >
                              <Layout as="main" aria-label="Station dashboard">
                                <Dashboard
                                  items={dashboard.items}
                                  layouts={dashboard.layouts}
                                  currentLayouts={dashboard.currentLayouts}
                                  breakpoint={dashboard.breakpoint}
                                  onLayoutChange={dashboard.handleLayoutChange}
                                  onBreakpointChange={
                                    dashboard.handleBreakpointChange
                                  }
                                  updateItemConfig={dashboard.updateItemConfig}
                                  updateItemMappings={
                                    dashboard.updateItemMappings
                                  }
                                  updateItemMobileWidth={
                                    dashboard.updateItemMobileWidth
                                  }
                                  updateItemMobileHeight={
                                    dashboard.updateItemMobileHeight
                                  }
                                  removeItem={dashboard.removeItem}
                                  moveItemUp={dashboard.moveItemUp}
                                  moveItemDown={dashboard.moveItemDown}
                                  lastAddedId={dashboard.lastAddedId}
                                  clearLastAdded={dashboard.clearLastAdded}
                                />
                                <FabClusterProvider>
                                  <ComponentOverlay
                                    currentLayouts={dashboard.currentLayouts}
                                  />
                                  <FlightsFab />
                                  <SerialPortRecoveryWatcher />
                                  <StationConnectionFab
                                    bottom={144}
                                    hostId={hostInput || null}
                                    connStatus={connStatus}
                                    onSwitchHost={(next) => {
                                      // Hard-navigate so all data sources,
                                      // listeners, and PeerClient state are
                                      // dropped cleanly. attemptConnect on
                                      // the fresh mount re-establishes the
                                      // connection against the new host.
                                      globalThis.location.assign(
                                        `/station?host=${encodeURIComponent(
                                          next,
                                        )}`,
                                      );
                                    }}
                                    onDisconnect={() => {
                                      // Clear the persisted host so the next
                                      // mount lands on the connect screen
                                      // rather than auto-reconnecting.
                                      localStorage.removeItem(HOST_ID_KEY);
                                      globalThis.location.assign("/station");
                                    }}
                                  />
                                  <FullscreenFab bottom={204} />
                                  <SettingsFab bottom={264} />
                                  <MissionProfilesFab
                                    bottom={324}
                                    currentItems={dashboard.items}
                                    currentLayouts={dashboard.layouts}
                                    onLoad={(p) =>
                                      dashboard.replaceState(p.items, p.layouts)
                                    }
                                  />
                                  <AlarmsFab
                                    bottom={384}
                                    useSnapshot={useStationAlarmSnapshot}
                                    onAdd={(input) =>
                                      alarmClient.addAlarm(input)
                                    }
                                    onUpdate={(id, patch) =>
                                      alarmClient.updateAlarm(id, patch)
                                    }
                                    onDelete={(id) =>
                                      alarmClient.deleteAlarm(id)
                                    }
                                    ModalComponent={AlarmsModal}
                                  />
                                </FabClusterProvider>
                                <StationNameChip>
                                  <StationNameEditor compact />
                                </StationNameChip>
                                <BannerStack>
                                  <StationAlarmBanner
                                    useSnapshot={useStationAlarmSnapshot}
                                    onAcknowledge={(id) =>
                                      alarmClient.acknowledgeAlarm(id)
                                    }
                                  />
                                  <HostDisconnectBanner client={client} />
                                  <SignalLossIndicator />
                                  <TelemachusAntennaBanner />
                                  <SustainedFailureBanner />
                                  <HostVersionBanner client={client} />
                                  <FlightOutcomeBanner />
                                  <SceneSwitchPrompt
                                    onLoad={(items, layouts) =>
                                      dashboard.replaceState(items, layouts)
                                    }
                                  />
                                </BannerStack>
                              </Layout>
                            </AlarmsLauncherBridge>
                          </OverlayProvider>
                        </SerialDeviceProvider>
                      </KosProxyContext.Provider>
                    </FogMaskCacheProvider>
                  </PushClientProvider>
                </ManeuverTriggerProvider>
              </PeerClientProvider>
            </ScopedStationIdentity>
          </MissionProfilesProvider>
        </CpuRegistryProvider>
      </SettingsProvider>
    </ScreenProvider>
  );
}

/**
 * Mounted inside the SettingsProvider (and only under the connected branch)
 * so `useStationWakeLock` can resolve the setting via context. Exists as a
 * component rather than a top-level hook call because the provider that
 * supplies the context is defined inside this same screen.
 */
function StationWakeLockBridge() {
  useStationWakeLock(true);
  return null;
}

const ConnectLayout = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  background: var(--color-surface-app);
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
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
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
`;

const ConnectButton = styled.button`
  background: var(--color-status-info-bg);
  border: 1px solid var(--color-status-info-bg);
  border-radius: 4px;
  padding: 8px 20px;
  color: var(--color-status-info-fg);
  font-size: 14px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--color-status-info-bg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
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
`;

function describeConnStatus(
  status: ConnStatus,
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

function statusTone(
  status: ConnStatus,
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

const Layout = styled.div`
  padding: 24px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  padding-left: calc(24px + env(safe-area-inset-left, 0px));
  padding-right: calc(24px + env(safe-area-inset-right, 0px));
  background: var(--color-surface-app);
  min-height: 100vh;
`;

/**
 * Keeps the host up to date with this station's current name. Sends on every
 * transition into "connected" (covers reconnect) and again whenever the
 * user renames.
 */
function StationInfoBroadcaster({ client }: { client: PeerClientService }) {
  const name = useStationName();
  useEffect(() => {
    const send = () =>
      client.sendStationInfo(name, {
        version: VERSION,
        buildTime: BUILD_TIME,
      });
    const unsub = client.onConnectionStatus((status) => {
      if (status === "connected") send();
    });
    // Fire once immediately in case we're already connected by the time
    // this effect runs (or the name changes while connected).
    send();
    return () => {
      unsub();
    };
  }, [client, name]);
  return null;
}

const NameRow = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border-subtle);
`;

const StationNameChip = styled.div`
  position: fixed;
  top: 12px;
  right: 16px;
  padding: 4px 10px;
  background: rgba(20, 20, 20, 0.85);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  z-index: 800;
  /*
   * The chip's padding / background area used to intercept clicks on
   * widgets beneath it (operator at LFV-1b test, 2026-05-17 session).
   * Pass pointer events through the wrapper but keep the interactive
   * children (rename button, input) clickable.
   */
  pointer-events: none;

  button,
  input {
    pointer-events: auto;
  }
`;
