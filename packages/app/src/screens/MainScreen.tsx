import { ManeuverTriggerProvider } from "@gonogo/components";
import {
  getDataSource,
  getDataSources,
  getStreamSources,
  ScreenProvider,
} from "@gonogo/core";
import type { BufferedDataSource } from "@gonogo/data";
import {
  CpuRegistryProvider,
  CpuRegistryService,
  FlightsFab,
  FogMaskCacheProvider,
  FogMaskStore,
  ReplayBanner,
} from "@gonogo/data";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialFab,
  SerialPortRecoveryWatcher,
} from "@gonogo/serial";
import { FabClusterProvider } from "@gonogo/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  AlarmBanner,
  AlarmHostProvider,
  AlarmsFab,
  AlarmsLauncherBridge,
  AlarmsModal,
  createAlarmHost,
  useAlarmHost,
} from "../alarms";
import type { AlarmSnapshot } from "../alarms/types";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";
import { Dashboard } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";
import { FullscreenFab } from "../components/FullscreenFab";
import { SceneChangeBanner } from "../components/SceneChangeBanner";
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { StationLinkFab } from "../components/StationLinkFab";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";
import { KosDataSource } from "../dataSources/kos";
import { FogSyncHostService } from "../fog/FogSyncHostService";
import { GoNoGoHostProvider, GoNoGoHostService } from "../goNoGo";
import { LogsFab } from "../logs/LogsFab";
import { createManeuverTriggerHost } from "../maneuverTriggers";
import {
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
} from "../missionProfiles";
import { createNotesHost } from "../notes/createNotesHost";
import { NotesHostProvider } from "../notes/NotesHostContext";
import { peerHostService } from "../peer/PeerHostService";
import { PushedDashboardOverlay } from "../pushToMain/PushedDashboardOverlay";
import { PushHostProvider } from "../pushToMain/PushHostContext";
import { PushHostService } from "../pushToMain/PushHostService";
import {
  SaveProfileProvider,
  SaveProfileService,
  SaveProfilesFab,
  useActiveProfile,
} from "../saveProfiles";
import { SettingsFab, SettingsProvider, SettingsService } from "../settings";
import { DEMO_CONFIG } from "./demoConfig";

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function MainScreen() {
  useEffect(() => {
    document.title = "gonogo — Main";
  }, []);
  const dashboard = useDashboardState("gonogo:dashboard:main", DEMO_CONFIG);
  const [serialService] = useState(
    () => new SerialDeviceService({ screenKey: "main" }),
  );
  const [saveProfileService] = useState(() => new SaveProfileService());
  const [settingsService] = useState(() => new SettingsService());
  const [missionProfiles] = useState(() => new MissionProfilesService("main"));
  const [cpuRegistry] = useState(() => new CpuRegistryService("main"));
  const [fogMaskStore] = useState(() => new FogMaskStore());
  // GoNoGoHostService lives for the app's lifetime. Intentionally no dispose
  // cleanup — StrictMode's simulated unmount would run it and leave the
  // second mount with a zombie service that no longer receives host events
  // (the useState initializer only runs once per mount cycle).
  const [goNoGoHost] = useState(() => new GoNoGoHostService(peerHostService));
  const [pushHost] = useState(() => new PushHostService(peerHostService));
  const [alarmHost] = useState(() =>
    createAlarmHost(
      peerHostService,
      () => (getDataSource("data") as BufferedDataSource | undefined) ?? null,
    ),
  );
  const [notesHost] = useState(() => createNotesHost(peerHostService));
  const [maneuverTriggerHost] = useState(() =>
    createManeuverTriggerHost(
      peerHostService,
      () => (getDataSource("data") as BufferedDataSource | undefined) ?? null,
    ),
  );
  const [fogSyncHost] = useState(
    () =>
      new FogSyncHostService({
        peerHost: peerHostService,
        fogStore: fogMaskStore,
        getActiveProfileId: () => saveProfileService.getActiveId(),
      }),
  );
  useEffect(() => {
    fogSyncHost.start();
    return () => fogSyncHost.stop();
  }, [fogSyncHost]);

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
    // Auto-reopen previously-authorised serial ports on load. Silent no-op
    // on browsers without Web Serial, or when there are no saved devices.
    // Also re-attach the navigator.serial hot-plug listeners — destroy()
    // detaches them, so a StrictMode cleanup→setup cycle would otherwise
    // leave hot-plug silently dead for the rest of the page lifetime.
    serialService.attachNavigatorListeners();
    void serialService.autoReconnect();
    return () => {
      // Detach navigator.serial listeners + tear down transports when the
      // screen unmounts (e.g. route change). Without this the next screen's
      // service would race with the old one to adopt hot-plug events.
      void serialService.destroy();
    };
  }, [serialService]);

  useEffect(() => {
    // Auto-populate the kOS CPU registry from the menu the proxy reads
    // every time we attach. Stations don't fire this hook — they don't
    // talk to the proxy directly.
    const kos = getDataSource("kos");
    if (!(kos instanceof KosDataSource)) return;
    return kos.onCpusDiscovered((cpus) => {
      cpuRegistry.reportOnline(cpus.map((c) => c.tagname));
    });
  }, [cpuRegistry]);

  useEffect(() => {
    const sources = getDataSources();
    sources.forEach((s) => {
      void s.connect();
    });
    const streamSources = getStreamSources();
    streamSources.forEach((s) => {
      void s.connect();
    });
    return () => {
      sources.forEach((s) => {
        s.disconnect();
      });
      streamSources.forEach((s) => {
        s.disconnect();
      });
    };
  }, []);

  return (
    <ScreenProvider value="main">
      <SettingsProvider service={settingsService}>
        <AlarmHostProvider service={alarmHost}>
          <NotesHostProvider service={notesHost}>
            <ManeuverTriggerProvider service={maneuverTriggerHost}>
              <CpuRegistryProvider service={cpuRegistry}>
                <MissionProfilesProvider service={missionProfiles}>
                  <SaveProfileProvider service={saveProfileService}>
                    <GoNoGoHostProvider service={goNoGoHost}>
                      <PushHostProvider service={pushHost}>
                        <ScopedFogMaskCache store={fogMaskStore}>
                          <SerialDeviceProvider service={serialService}>
                            <OverlayProvider
                              addItem={dashboard.addItem}
                              updateItemConfig={dashboard.updateItemConfig}
                            >
                              <MainAlarmsLauncherScope>
                                <Layout as="main" aria-label="Mission control">
                                  <Dashboard
                                    items={dashboard.items}
                                    layouts={dashboard.layouts}
                                    currentLayouts={dashboard.currentLayouts}
                                    breakpoint={dashboard.breakpoint}
                                    onLayoutChange={
                                      dashboard.handleLayoutChange
                                    }
                                    onBreakpointChange={
                                      dashboard.handleBreakpointChange
                                    }
                                    updateItemConfig={
                                      dashboard.updateItemConfig
                                    }
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
                                    <SerialFab />
                                    <SerialPortRecoveryWatcher />
                                    <StationLinkFab />
                                    <SaveProfilesFab />
                                    <LogsFab />
                                    <FullscreenFab />
                                    <SettingsFab bottom={444} />
                                    <MissionProfilesFab
                                      bottom={504}
                                      currentItems={dashboard.items}
                                      currentLayouts={dashboard.layouts}
                                      onLoad={(p) =>
                                        dashboard.replaceState(
                                          p.items,
                                          p.layouts,
                                        )
                                      }
                                    />
                                    <MainAlarmsFab />
                                  </FabClusterProvider>
                                  <AlarmBanner />
                                  <ReplayBanner />
                                  <SignalLossIndicator />
                                  <SustainedFailureBanner />
                                  <SceneChangeBanner />
                                  <PushedDashboardOverlay />
                                </Layout>
                              </MainAlarmsLauncherScope>
                            </OverlayProvider>
                          </SerialDeviceProvider>
                        </ScopedFogMaskCache>
                      </PushHostProvider>
                    </GoNoGoHostProvider>
                  </SaveProfileProvider>
                </MissionProfilesProvider>
              </CpuRegistryProvider>
            </ManeuverTriggerProvider>
          </NotesHostProvider>
        </AlarmHostProvider>
      </SettingsProvider>
    </ScreenProvider>
  );
}

/**
 * Closure-based snapshot hook so the modal works without needing
 * AlarmHostContext in its ancestor tree — ModalProvider mounts portaled
 * modals above this point in the tree, so the context-reading variant
 * (useAlarmSnapshot) throws when called from inside the modal. Same shape
 * as the station-side equivalent in StationScreen.
 */
function useMainAlarmsBindings() {
  const host = useAlarmHost();
  const useSnapshot = useMemo(
    () => () => {
      // biome-ignore lint/correctness/useHookAtTopLevel: defining a hook
      const [snap, setSnap] = useState<AlarmSnapshot>(() => host.snapshot());
      // biome-ignore lint/correctness/useHookAtTopLevel: defining a hook
      useEffect(() => host.subscribe(setSnap), []);
      return snap;
    },
    [host],
  );
  return useMemo(
    () => ({
      useSnapshot,
      onAdd: (input: Parameters<typeof host.addAlarm>[0]) => {
        host.addAlarm(input);
      },
      onUpdate: (id: string, patch: Parameters<typeof host.updateAlarm>[1]) =>
        host.updateAlarm(id, patch),
      onDelete: (id: string) => host.deleteAlarm(id),
    }),
    [host, useSnapshot],
  );
}

/**
 * Mounts the AlarmsLauncherBridge so widgets (e.g. the ActionGroup bell)
 * can open the alarms modal pre-populated with `onFire`. Wraps the
 * dashboard subtree.
 */
function MainAlarmsLauncherScope({ children }: { children: ReactNode }) {
  const bindings = useMainAlarmsBindings();
  return <AlarmsLauncherBridge {...bindings}>{children}</AlarmsLauncherBridge>;
}

/**
 * Mounts the shared AlarmsFab backed by the main-screen AlarmHostService.
 * Lives here rather than in @gonogo/app/alarms so the FAB stays agnostic
 * between main (host) and station (peer client).
 */
function MainAlarmsFab() {
  const bindings = useMainAlarmsBindings();
  return (
    <AlarmsFab
      bottom={564}
      useSnapshot={bindings.useSnapshot}
      onAdd={bindings.onAdd}
      onUpdate={bindings.onUpdate}
      onDelete={bindings.onDelete}
      ModalComponent={AlarmsModal}
    />
  );
}

// Thin adapter that reads the active profile from the save-profile context
// and re-binds the fog cache to it. Lives here rather than in @gonogo/data
// so the data package stays ignorant of save-profile concerns.
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

const Layout = styled.div`
  padding: 24px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  padding-left: calc(24px + env(safe-area-inset-left, 0px));
  padding-right: calc(24px + env(safe-area-inset-right, 0px));
  background: var(--color-surface-app);
  min-height: 100vh;
`;
