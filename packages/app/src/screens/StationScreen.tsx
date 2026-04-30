import {
  debugPeer,
  getStreamSources,
  KosProxyContext,
  registerDataSource,
  registerStreamSource,
  ScreenProvider,
} from "@gonogo/core";
import {
  CpuRegistryProvider,
  CpuRegistryService,
  FlightsFab,
  FogMaskCacheProvider,
  FogMaskStore,
} from "@gonogo/data";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialFab,
} from "@gonogo/serial";
import { FabClusterProvider } from "@gonogo/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  AlarmClientService,
  type AlarmSnapshot,
  AlarmsFab,
  AlarmsModal,
} from "../alarms";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";
import type { DashboardConfig } from "../components/Dashboard";
import { Dashboard } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";
import { FullscreenFab } from "../components/FullscreenFab";
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { LogsFab } from "../logs/LogsFab";
import {
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
} from "../missionProfiles";
import { HostVersionBanner } from "../peer/HostVersionBanner";
import { KosPeerConnection } from "../peer/KosPeerConnection";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { ConnStatus } from "../peer/PeerClientService";
import { PeerClientService } from "../peer/PeerClientService";
import { PushClientProvider } from "../pushToMain/PushClientContext";
import {
  SaveProfileProvider,
  SaveProfileService,
  SaveProfilesFab,
  useActiveProfile,
} from "../saveProfiles";
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
import { OcislyStreamSource } from "../streamSources/ocisly";
import { BUILD_TIME, VERSION } from "../version";

const HOST_ID_KEY = "gonogo-station-host-id";

const DEFAULT_CONFIG: DashboardConfig = {
  items: [{ i: "status", componentId: "data-source-status" }],
  layouts: {
    lg: [{ w: 8, h: 6, x: 0, y: 0, i: "status", moved: false, static: false }],
  },
};

export function StationScreen() {
  useEffect(() => {
    document.title = "gonogo — Station";
  }, []);
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [hostInput, setHostInput] = useState(
    localStorage.getItem(HOST_ID_KEY) ?? "",
  );
  const [client] = useState(() => new PeerClientService());
  const dashboard = useDashboardState(
    "gonogo:dashboard:station",
    DEFAULT_CONFIG,
  );
  const [serialService] = useState(
    () => new SerialDeviceService({ screenKey: "station" }),
  );
  const [saveProfileService] = useState(() => new SaveProfileService());
  const [settingsService] = useState(() => new SettingsService());
  const [missionProfiles] = useState(
    () => new MissionProfilesService("station"),
  );
  const [cpuRegistry] = useState(() => new CpuRegistryService("station"));
  const [alarmClient] = useState(() => new AlarmClientService(client));
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
    // "auto-reconnect on station refresh" live-test bug.
    void serialService.autoReconnect();
  }, [serialService]);

  function attemptConnect(hostId: string) {
    const trimmed = hostId.trim().toUpperCase();
    if (!trimmed) return;
    localStorage.setItem(HOST_ID_KEY, trimmed);

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

    unsubsRef.current.push(client.onConnectionStatus(setConnStatus));
    unsubsRef.current.push(
      client.onSchema((sources) => {
        if (schemaHandledRef.current) return;
        schemaHandledRef.current = true;
        for (const s of sources) {
          const source = new PeerClientDataSource(s.id, s.name, client);
          source.setSchema(s.keys);
          registerDataSource(source);
          void source.connect();
        }

        // Station-side OCISLY stream source: overrides the default host
        // registration (same id) with a variant that uses the station's own
        // Peer and receives the proxy peer id from the host via the existing
        // data channel. Registration happens after schema so the connect()
        // below reliably sees all sources, including this one.
        const ocislySource = new OcislyStreamSource({
          peerProvider: () => client.waitForPeer(),
          proxyPeerIdProvider: () =>
            new Promise<string>((resolve) => {
              const cached = client.getOcislyProxyPeerId();
              if (cached) {
                resolve(cached);
                return;
              }
              const remove = client.onOcislyProxyPeerIdChange((peerId) => {
                if (peerId) {
                  remove();
                  resolve(peerId);
                }
              });
            }),
        });
        registerStreamSource(ocislySource);

        for (const streamSource of getStreamSources()) {
          void streamSource.connect();
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
      for (const s of getStreamSources()) s.disconnect();
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
              <SaveProfileProvider service={saveProfileService}>
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
                      {connStatus === "disconnected" && (
                        <ErrorMsg>
                          Connection lost. Check the host ID and try again.
                        </ErrorMsg>
                      )}
                    </ConnectBox>
                  </ConnectLayout>
                </ScopedStationIdentity>
              </SaveProfileProvider>
            </MissionProfilesProvider>
          </CpuRegistryProvider>
        </SettingsProvider>
      </ScreenProvider>
    );
  }

  return (
    <ScreenProvider value="station">
      <SettingsProvider service={settingsService}>
        <MissionProfilesProvider service={missionProfiles}>
          <StationWakeLockBridge />
          <SaveProfileProvider service={saveProfileService}>
            <ScopedStationIdentity>
              <StationInfoBroadcaster client={client} />
              <PeerClientProvider client={client}>
                <PushClientProvider>
                  <ScopedFogMaskCache store={fogMaskStore}>
                    <KosProxyContext.Provider value={kosProxy}>
                      <SerialDeviceProvider service={serialService}>
                        <OverlayProvider
                          addItem={dashboard.addItem}
                          updateItemConfig={dashboard.updateItemConfig}
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
                              updateItemMappings={dashboard.updateItemMappings}
                              removeItem={dashboard.removeItem}
                              moveItemUp={dashboard.moveItemUp}
                              moveItemDown={dashboard.moveItemDown}
                            />
                            <FabClusterProvider>
                              <ComponentOverlay
                                currentLayouts={dashboard.currentLayouts}
                              />
                              <FlightsFab />
                              <SerialFab />
                              <SaveProfilesFab bottom={204} />
                              <LogsFab bottom={264} />
                              <FullscreenFab bottom={324} />
                              <SettingsFab bottom={384} />
                              <MissionProfilesFab
                                bottom={444}
                                currentItems={dashboard.items}
                                currentLayouts={dashboard.layouts}
                                onLoad={(p) =>
                                  dashboard.replaceState(p.items, p.layouts)
                                }
                              />
                              <AlarmsFab
                                bottom={504}
                                useSnapshot={useStationAlarmSnapshot}
                                onAdd={(input) => alarmClient.addAlarm(input)}
                                onUpdate={(id, patch) =>
                                  alarmClient.updateAlarm(id, patch)
                                }
                                onDelete={(id) => alarmClient.deleteAlarm(id)}
                                ModalComponent={AlarmsModal}
                              />
                            </FabClusterProvider>
                            <StationNameChip>
                              <StationNameEditor compact />
                            </StationNameChip>
                            <SignalLossIndicator />
                            <HostVersionBanner client={client} />
                          </Layout>
                        </OverlayProvider>
                      </SerialDeviceProvider>
                    </KosProxyContext.Provider>
                  </ScopedFogMaskCache>
                </PushClientProvider>
              </PeerClientProvider>
            </ScopedStationIdentity>
          </SaveProfileProvider>
        </MissionProfilesProvider>
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

function ScopedFogMaskCache({
  store,
  children,
}: {
  store: FogMaskStore;
  children: ReactNode;
}) {
  const profile = useActiveProfile();
  return (
    <FogMaskCacheProvider store={store} profileId={profile.id}>
      {children}
    </FogMaskCacheProvider>
  );
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
`;
