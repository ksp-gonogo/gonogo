import { ManeuverTriggerProvider } from "@ksp-gonogo/components";
import {
  getDataSource,
  getDataSources,
  ScreenProvider,
  useGameContext,
} from "@ksp-gonogo/core";
import type { BufferedDataSource } from "@ksp-gonogo/data";
import {
  CpuRegistryProvider,
  CpuRegistryService,
  FlightsFab,
  FogMaskCacheProvider,
  FogMaskStore,
  ReplayBanner,
} from "@ksp-gonogo/data";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialPortRecoveryWatcher,
} from "@ksp-gonogo/serial";
import { BannerStack, FabClusterProvider } from "@ksp-gonogo/ui";
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
  FiredAlarmPills,
  SafetyMarginPill,
  UnscheduledWarpPill,
  useAlarmHost,
} from "../alarms";
import type { AlarmSnapshot } from "../alarms/types";
import { AnalyticsConsentHost } from "../analytics/AnalyticsConsentHost";
import { analyticsConsentService } from "../analytics/AnalyticsConsentService";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";
import { Dashboard } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";
import { FlightOutcomeBanner } from "../components/FlightOutcomeBanner";
import { FullscreenFab } from "../components/FullscreenFab";
import { SceneChangeBanner } from "../components/SceneChangeBanner";
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { StationLinkFab } from "../components/StationLinkFab";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";
import { TelemachusAntennaBanner } from "../components/TelemachusAntennaBanner";
import { KosDataSource } from "../dataSources/kos";
import { FogSyncHostService } from "../fog/FogSyncHostService";
import { GoNoGoHostProvider, GoNoGoHostService } from "../goNoGo";
import { createManeuverTriggerHost } from "../maneuverTriggers";
import {
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
  SceneSwitchPrompt,
} from "../missionProfiles";
import { createNotesHost } from "../notes/createNotesHost";
import { NotesHostProvider } from "../notes/NotesHostContext";
import { peerHostService } from "../peer/PeerHostService";
import { PushedDashboardOverlay } from "../pushToMain/PushedDashboardOverlay";
import { PushHostProvider } from "../pushToMain/PushHostContext";
import { PushHostService } from "../pushToMain/PushHostService";
import { SettingsFab, SettingsProvider, SettingsService } from "../settings";
import { initSoundSettings } from "../sound";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { DEMO_CONFIG } from "./demoConfig";

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

// Per-scene working layouts: each of the four "real" KSP scenes gets its own
// auto-persisted dashboard slot, so edits made in one scene survive switching
// to another and back (instead of a scene-bound load clobbering the single
// shared dashboard). Transient/unknown scenes fall back to the shared base
// key — which is also the legacy key, so existing dashboards load unchanged
// with no migration step.
const BASE_DASHBOARD_KEY = "gonogo:dashboard:main";
const SCENE_SCOPED_KEYS = new Set([
  "SpaceCenter",
  "Editor",
  "Flight",
  "TrackingStation",
]);

function dashboardKeyForScene(scene: string | undefined): string {
  return scene && SCENE_SCOPED_KEYS.has(scene)
    ? `${BASE_DASHBOARD_KEY}:${scene}`
    : BASE_DASHBOARD_KEY;
}

export function MainScreen() {
  useEffect(() => {
    document.title = "gonogo - Main";
  }, []);
  const { scene } = useGameContext();
  const dashboard = useDashboardState(dashboardKeyForScene(scene), DEMO_CONFIG);
  const [serialService] = useState(
    () => new SerialDeviceService({ screenKey: "main" }),
  );
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
      }),
  );
  useEffect(() => {
    fogSyncHost.start();
    return () => fogSyncHost.stop();
  }, [fogSyncHost]);

  // Prime the module-scoped sound flag from the persisted setting and keep
  // it in sync. MAIN-ONLY — StationScreen never calls this, so station
  // tones stay structurally impossible. Default ON.
  useEffect(() => initSoundSettings(settingsService), [settingsService]);

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
      // A source that can't connect (e.g. kerbcast with no sidecar reachable)
      // settles its own status + schedules its own reconnect; swallow the
      // rejection here so it doesn't surface as an unhandled promise rejection.
      void s.connect().catch(() => {});
    });
    return () => {
      sources.forEach((s) => {
        s.disconnect();
      });
    };
  }, []);

  return (
    <SitrepTelemetryProvider>
      <ScreenProvider value="main">
        <SettingsProvider service={settingsService}>
          <AnalyticsConsentHost
            service={analyticsConsentService}
            peerHost={peerHostService}
          />
          <AlarmHostProvider service={alarmHost}>
            <NotesHostProvider service={notesHost}>
              <ManeuverTriggerProvider service={maneuverTriggerHost}>
                <CpuRegistryProvider service={cpuRegistry}>
                  <MissionProfilesProvider service={missionProfiles}>
                    <GoNoGoHostProvider service={goNoGoHost}>
                      <PushHostProvider service={pushHost}>
                        <FogMaskCacheProvider store={fogMaskStore}>
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
                                    <SerialPortRecoveryWatcher />
                                    <StationLinkFab />
                                    <FullscreenFab bottom={204} />
                                    <SettingsFab bottom={264} />
                                    <MissionProfilesFab
                                      bottom={324}
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
                                  <ReplayBanner />
                                  <BannerStack>
                                    {/* BannerStack is row-reverse —
                                        first DOM child sits closest
                                        to the FAB. AlarmBanner stays
                                        adjacent; per-concern pills
                                        (safety margin, fired alarms,
                                        unscheduled warp) stack to its
                                        left as separate single-row
                                        pills. */}
                                    <AlarmBanner />
                                    <SafetyMarginPill />
                                    <FiredAlarmPills />
                                    <UnscheduledWarpPill />
                                    <SignalLossIndicator />
                                    <TelemachusAntennaBanner />
                                    <SustainedFailureBanner />
                                    <SceneChangeBanner />
                                    <FlightOutcomeBanner />
                                    <SceneSwitchPrompt
                                      onLoad={(items, layouts) =>
                                        dashboard.replaceState(items, layouts)
                                      }
                                    />
                                  </BannerStack>
                                  <PushedDashboardOverlay />
                                </Layout>
                              </MainAlarmsLauncherScope>
                            </OverlayProvider>
                          </SerialDeviceProvider>
                        </FogMaskCacheProvider>
                      </PushHostProvider>
                    </GoNoGoHostProvider>
                  </MissionProfilesProvider>
                </CpuRegistryProvider>
              </ManeuverTriggerProvider>
            </NotesHostProvider>
          </AlarmHostProvider>
        </SettingsProvider>
      </ScreenProvider>
    </SitrepTelemetryProvider>
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
 * Lives here rather than in @ksp-gonogo/app/alarms so the FAB stays agnostic
 * between main (host) and station (peer client).
 */
function MainAlarmsFab() {
  const bindings = useMainAlarmsBindings();
  return (
    <AlarmsFab
      bottom={384}
      useSnapshot={bindings.useSnapshot}
      onAdd={bindings.onAdd}
      onUpdate={bindings.onUpdate}
      onDelete={bindings.onDelete}
      ModalComponent={AlarmsModal}
    />
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
