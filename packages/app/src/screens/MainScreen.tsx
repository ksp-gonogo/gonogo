import {
  getDataSource,
  getDataSources,
  getStreamSources,
  ScreenProvider,
} from "@gonogo/core";
import type { BufferedDataSource } from "@gonogo/data";
import { FlightsFab, FogMaskCacheProvider, FogMaskStore } from "@gonogo/data";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialFab,
} from "@gonogo/serial";
import { FabClusterProvider } from "@gonogo/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  AlarmBanner,
  AlarmHostProvider,
  AlarmsFab,
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
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { StationLinkFab } from "../components/StationLinkFab";
import { GoNoGoHostProvider, GoNoGoHostService } from "../goNoGo";
import { LogsFab } from "../logs/LogsFab";
import {
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
} from "../missionProfiles";
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
    void serialService.autoReconnect();
  }, [serialService]);

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
                        <Layout as="main" aria-label="Mission control">
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
                                dashboard.replaceState(p.items, p.layouts)
                              }
                            />
                            <MainAlarmsFab />
                          </FabClusterProvider>
                          <AlarmBanner />
                          <SignalLossIndicator />
                          <PushedDashboardOverlay />
                        </Layout>
                      </OverlayProvider>
                    </SerialDeviceProvider>
                  </ScopedFogMaskCache>
                </PushHostProvider>
              </GoNoGoHostProvider>
            </SaveProfileProvider>
          </MissionProfilesProvider>
        </AlarmHostProvider>
      </SettingsProvider>
    </ScreenProvider>
  );
}

/**
 * Mounts the shared AlarmsFab backed by the main-screen AlarmHostService.
 * Lives here rather than in @gonogo/app/alarms so the FAB stays agnostic
 * between main (host) and station (peer client).
 */
function MainAlarmsFab() {
  const host = useAlarmHost();
  // Closure-based snapshot hook so the modal works without needing
  // AlarmHostContext in its ancestor tree — ModalProvider mounts portaled
  // modals above this point in the tree, so the context-reading variant
  // (useAlarmSnapshot) throws when called from inside the modal. Mirrors
  // the station-side pattern in StationScreen.
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
  return (
    <AlarmsFab
      bottom={564}
      useSnapshot={useSnapshot}
      onAdd={(input) => host.addAlarm(input)}
      onUpdate={(id, patch) => host.updateAlarm(id, patch)}
      onDelete={(id) => host.deleteAlarm(id)}
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
