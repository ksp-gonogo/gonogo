import {
  ManeuverTriggerProvider,
  WarpIntentProvider,
} from "@ksp-gonogo/components";
import {
  type GameScene,
  getDataSources,
  type Screen,
  ScreenProvider,
  useGameContext,
} from "@ksp-gonogo/core";
import {
  AutoRecordController,
  CoverageMaskCacheProvider,
  FlightsFab,
  ReplaySessionBanner,
  ReplaySessionProvider,
} from "@ksp-gonogo/data";
import {
  InputDispatcher,
  SerialDeviceProvider,
  SerialDeviceService,
  SerialPortRecoveryWatcher,
} from "@ksp-gonogo/serial";
import type { Transport } from "@ksp-gonogo/sitrep-client";
import { RootProviders } from "@ksp-gonogo/sitrep-sdk";
import { BannerStack, FabClusterProvider } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  AlarmBanner,
  AlarmClientService,
  AlarmHostProvider,
  AlarmsCancelledPill,
  AlarmsFab,
  AlarmsLauncherBridge,
  AlarmsModal,
  FiredAlarmPills,
  NO_ALARM_SERVICE,
  SafetyMarginPill,
  UnscheduledWarpPill,
  useAlarmHost,
} from "../alarms";
import type { AlarmSnapshot } from "../alarms/types";
import { AnalyticsConsentHost } from "../analytics/AnalyticsConsentHost";
import { analyticsConsentService } from "../analytics/AnalyticsConsentService";
import { ModLogForwarder } from "../analytics/ModLogForwarder";
import { CommcastLink } from "../commcast/CommcastLink";
import type { CommcastLog } from "../commcast/CommcastLog";
import { CommcastLogProvider } from "../commcast/CommcastLogContext";
import { createCommcastLog } from "../commcast/createCommcastLog";
import { ComponentOverlay } from "../components/ComponentOverlay";
import type { DashboardConfig } from "../components/Dashboard";
import { Dashboard } from "../components/Dashboard";
import { DashboardShortcuts } from "../components/DashboardShortcuts";
import {
  ContactLossBanner,
  FlightOutcomeBanner,
} from "../components/FlightOutcomeBanner";
import { FullscreenFab } from "../components/FullscreenFab";
import { HeaderBadges } from "../components/HeaderBadges";
import { HomeFallbackNotice } from "../components/HomeFallbackNotice";
import { MissionBanner } from "../components/MissionBanner";
import { ModVersionBanner } from "../components/ModVersionBanner";
import { SceneChangeBanner } from "../components/SceneChangeBanner";
import { SignalLossIndicator } from "../components/SignalLossIndicator";
import { StationBuildMismatchNotice } from "../components/StationBuildMismatchNotice";
import { StationLinkFab } from "../components/StationLinkFab";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";
import { FirstRunSetupHost } from "../firstRun/FirstRunSetupHost";
import {
  GoNoGoHostProvider,
  MainPollHeader,
  PollSettingsControl,
  StageCountdownBridge,
  StationPollControl,
  voteInputSource,
} from "../goNoGo";
import {
  HostingProvider,
  PlainStationFeed,
  useHostingHosts,
} from "../hosting/HostingProvider";
import type { HostJobs } from "../hosting/HostJobs";
import { useHostRole } from "../hosting/HostRoleContext";
import {
  LayoutHistoryControl,
  MissionProfilesFab,
  MissionProfilesProvider,
  MissionProfilesService,
  ProfileDashboardProvider,
  ProfileOverlayProvider,
  ProfileSwitchBanner,
  profileInputOptions,
  SceneSwitchPrompt,
  useMissionProfilesService,
  useProfileDashboard,
} from "../missionProfiles";
import { NotesHostProvider } from "../notes/NotesHostContext";
import { useHostCentre } from "../peer/HostCommandCentreAnnouncer";
import type { PeerClientService } from "../peer/PeerClientService";
import { peerHostService } from "../peer/PeerHostService";
import { StationInfoBroadcaster } from "../peer/StationInfoBroadcaster";
import { PushedDashboardOverlay } from "../pushToMain/PushedDashboardOverlay";
import { PushHostProvider } from "../pushToMain/PushHostContext";
import { syncAutoPortForward } from "../relay/autoPortForward";
import {
  ConsoleSettingsFromHost,
  SettingsFab,
  SettingsProvider,
  SettingsService,
  useMissionHistorySettings,
} from "../settings";
import { HelpButton } from "../settings/HelpButton";
import { initSoundSettings } from "../sound";
import { StationApprovalPrompt } from "../stationApproval/StationApprovalPrompt";
import { ScopedStationIdentity } from "../stationIdentity";
import { AugmentAvailabilityFeeder } from "../telemetry/AugmentAvailabilityFeeder";
import { syncDataRate } from "../telemetry/dataRate";
import { PilotVantage } from "../telemetry/PilotVantage";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { reportSitrepTransportStatus } from "../telemetry/sitrepRuntime";
import { UplinkHealthRetry } from "../uplinks/UplinkHealthRetry";
import { UplinkIntegrityBanner } from "../uplinks/UplinkIntegrityBanner";
import { UplinkLoadGate } from "../uplinks/UplinkLoadGate";

const EMPTY_DASHBOARD: DashboardConfig = { items: [], layout: [] };

/**
 * What this device is called in the shared thread before anyone renames it.
 * A seat is a truthful thing to be called, and "Station ABCD" is the wrong
 * name for the operator running the mission from KSC.
 */
const DEFAULT_NAME_FOR: Record<Screen, string> = {
  main: "Mission Control",
  station: "Mission Control",
  pilot: "Pilot",
};

/**
 * Provides this screen's own Commcast log when the screen also routes the
 * mesh. A pilot page does not route anything: it joins as a peer, so it renders
 * its children with no provider and the widget builds its own log over the peer
 * link.
 *
 * The log is not a thread on anybody else's behalf. What it holds is what
 * reached this vantage, and the reason it is built here rather than in the
 * widget is that a message addressed here arrives whether or not the tile is on
 * the dashboard, and the relay has to keep running for the other stations.
 */
function CommcastLogProviderOrPassthrough({
  log,
  children,
}: {
  log: CommcastLog | null;
  children: ReactNode;
}) {
  if (!log) return <>{children}</>;
  return <CommcastLogProvider log={log}>{children}</CommcastLogProvider>;
}

/**
 * What a pilot sees when there is no craft to be aboard.
 *
 * Not an error, and not a blank page. The operator is in the VAB or the
 * tracking station and there is simply no vessel; a widget area that says so is
 * the honest answer, and the shared thread keeps working underneath because a
 * pilot sitting on the ground is still someone their crew can talk to.
 *
 * Suppressed until a game signal has arrived, the same way `RequiresGuard`
 * suppresses its overlay: on a refresh `scene` is `"Unknown"` until the first
 * frame, and announcing "no active vessel" across that window would be
 * asserting something no channel has said yet.
 */
function NoActiveVessel({
  hasGameSignal,
  scene,
}: {
  hasGameSignal: boolean;
  scene: GameScene;
}) {
  if (!hasGameSignal) return null;
  return (
    <NoActiveVessel__Body role="status" aria-live="polite">
      <strong>No active vessel</strong>
      <span>
        {scene === "Editor"
          ? "Editor scene: nothing is flying."
          : scene === "SpaceCenter"
            ? "At the space centre. Launch to take a seat."
            : scene === "TrackingStation"
              ? "Tracking station: switch to a vessel to fly it."
              : "Nothing is flying right now."}
      </span>
    </NoActiveVessel__Body>
  );
}

const NoActiveVessel__Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-related);
  padding: var(--inset-tile-message);
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  text-align: center;
`;

/**
 * A screen with its own view of the game, at whichever seat the route puts it.
 *
 * `"main"` stands at a command centre; `"pilot"` is a human aboard the craft,
 * a different seat on the same kind of connection. Either can host the peer
 * mesh or have joined another screen that does. The two seats share this file
 * rather than forking it because the twenty-deep provider tower below is the
 * thing that would drift.
 */
export function MainScreen({
  screen = "main",
  transport,
  hosting,
  jobs,
  joinedVia,
  hostLink,
}: {
  screen?: Screen;
  /** Whether this screen hosts the peer mesh. Absent, a mission-control screen does and a pilot's does not. */
  hosting?: boolean;
  /** The hosting screen's connection to the game for its own jobs, when it already holds one. */
  jobs?: HostJobs;
  /**
   * The peer link of a local screen that has joined another host, over which
   * it tells the host who it is and where it stands.
   */
  joinedVia?: PeerClientService;
  /**
   * The peer link to the host whose alarms and notes this screen reads, when it
   * joins one. Defaults to `joinedVia`.
   */
  hostLink?: PeerClientService;
  /**
   * The telemetry transport to observe through, instead of the direct
   * `ws://` socket this screen otherwise builds.
   *
   * A pilot that cannot reach the mod directly (a secure origin cannot open an
   * insecure socket, which is every hosted build) is fed through the peer link
   * it already holds instead, and the host serves it from a session at its own
   * vantage. Omitted everywhere else, which is the LAN case and stays a direct
   * session of its own.
   */
  transport?: Transport;
} = {}) {
  useEffect(() => {
    document.title = screen === "pilot" ? "gonogo - Pilot" : "gonogo - Main";
  }, [screen]);
  /*
   * Whether this screen builds the peer mesh and its canonical thread. A local
   * screen (`LocalScreen`) says so itself: it hosts when the mod grants it the
   * role, and otherwise joins the holder. A screen with no say defaults by
   * seat: mission control hosts, and a pilot page joins the mesh as a client
   * over `PilotScreen`'s link, so the canonical thread is somebody else's.
   */
  const hostsThePeerMesh = hosting ?? screen !== "pilot";
  return (
    <HostingProvider
      ownsMesh={hostsThePeerMesh}
      seat={screen === "pilot" ? "pilot" : "main"}
      jobs={jobs}
    >
      <MainScreenDisplay
        screen={screen}
        transport={transport}
        hostsThePeerMesh={hostsThePeerMesh}
        joinedVia={joinedVia}
        hostLink={hostLink ?? joinedVia}
      />
    </HostingProvider>
  );
}

/**
 * The screen's own display: a local reader at whatever seat the screen sits at,
 * and the dashboard drawn from it. The host services and the jobs connection it
 * sends commands through come from the hosting piece above.
 */
function MainScreenDisplay({
  screen,
  transport,
  hostsThePeerMesh,
  joinedVia,
  hostLink,
}: {
  screen: Screen;
  transport?: Transport;
  hostsThePeerMesh: boolean;
  joinedVia?: PeerClientService;
  hostLink?: PeerClientService;
}) {
  const hosts = useHostingHosts();
  const [alarmClient] = useState(() =>
    hostLink ? new AlarmClientService(hostLink) : null,
  );
  const [serialService] = useState(
    () => new SerialDeviceService({ screenKey: screen }),
  );
  const [settingsService] = useState(() => new SettingsService());
  const [missionProfiles] = useState(() => new MissionProfilesService(screen));
  const [commcastLog] = useState(() =>
    hostsThePeerMesh ? createCommcastLog() : null,
  );
  // Prime the module-scoped sound flag from the persisted setting and keep
  // it in sync. MAIN-ONLY: StationScreen never calls this, so station
  // tones stay structurally impossible. Default ON.
  useEffect(() => initSoundSettings(settingsService), [settingsService]);
  useEffect(() => syncDataRate(settingsService), [settingsService]);
  useEffect(
    () => (hostsThePeerMesh ? syncAutoPortForward(settingsService) : undefined),
    [hostsThePeerMesh, settingsService],
  );

  useEffect(() => {
    // Auto-reopen previously-authorised serial ports on load. Silent no-op
    // on browsers without Web Serial, or when there are no saved devices.
    // Also re-attach the navigator.serial hot-plug listeners: destroy()
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

  /*
   * A screen fed through a peer link opens no socket to the game, so the
   * Telemetry stream row reports that link's state. Left alone it keeps its
   * default "disconnected" and raises an offline banner over live readouts.
   */
  useEffect(() => {
    if (!transport) return;
    reportSitrepTransportStatus(transport.status);
    return transport.onStatusChange(reportSitrepTransportStatus);
  }, [transport]);

  useEffect(() => {
    const sources = getDataSources();
    sources.forEach((s) => {
      // A source that can't connect settles its own status + schedules its own
      // reconnect; swallow the rejection here so it doesn't surface as an
      // unhandled promise rejection. (An Uplink that connects itself rather
      // than registering a DataSource does so from its own root provider.)
      void s.connect().catch(() => {});
    });
    return () => {
      sources.forEach((s) => {
        s.disconnect();
      });
    };
  }, []);

  if (!hosts) return null;
  const { goNoGoHost, pushHost, notesHost, maneuverTriggerHost } = hosts;
  const alarmHost = hosts.alarmHost ?? alarmClient ?? NO_ALARM_SERVICE;

  return (
    <SitrepTelemetryProvider transport={transport} screenKey={screen}>
      <PlainStationFeed
        ownsMesh={hostsThePeerMesh}
        seat={screen === "pilot" ? "pilot" : "main"}
      />
      <CommcastLink log={commcastLog} />
      <AugmentAvailabilityFeeder />
      {screen !== "pilot" && <UplinkHealthRetry />}
      {/*
       * A pilot is aboard, so their session observes from the craft rather
       * than from KSC. Only this seat: `selectedVantageId` is client-wide, and
       * the main screen's own picker owns it there.
       */}
      {screen === "pilot" && <PilotVantage />}
      <ScreenProvider value={screen}>
        <SettingsProvider service={settingsService}>
          {screen === "main" && hostsThePeerMesh && (
            <>
              <AnalyticsConsentHost
                service={analyticsConsentService}
                peerHost={peerHostService}
              />
              <ModLogForwarder />
            </>
          )}
          <FirstRunSetupHost />
          <ConsoleSettingsFromHost service={settingsService} />
          {/*
           * Above the replay provider, so it records the live stream. Below
           * it, entering a replay would remount it, which saves the live
           * recording early, and it would then record the replay itself as
           * new missions.
           */}
          <AutoRecordControllerWithMissionHistory />
          <ReplaySessionProvider>
            <AlarmHostProvider service={alarmHost}>
              {/*
               * So a deliberate press on this screen's own warp control does
               * not trip this screen's own unscheduled-warp banner. Scoped to
               * THIS service on purpose: a pilot and a command centre each run
               * their own observer, and the ground is meant to see a warp it
               * did not ask for.
               */}
              <WarpIntentProvider
                announce={() => alarmHost.announceWarpIntent()}
              >
                <OptionalNotesHost service={notesHost}>
                  <ScopedStationIdentity defaultName={DEFAULT_NAME_FOR[screen]}>
                    {joinedVia && (
                      <JoinedScreenInfo client={joinedVia} screen={screen} />
                    )}
                    <CommcastLogProviderOrPassthrough log={commcastLog}>
                      <ManeuverTriggerProvider service={maneuverTriggerHost}>
                        <RootProviders screen={screen}>
                          <MissionProfilesProvider service={missionProfiles}>
                            <GoNoGoHostProvider service={goNoGoHost}>
                              <StageCountdownBridge />
                              <PushHostProvider service={pushHost}>
                                <CoverageMaskCacheProvider>
                                  <SerialDeviceProvider service={serialService}>
                                    <UplinkLoadGate host={peerHostService}>
                                      <MainDashboard
                                        screen={screen}
                                        hosting={hostsThePeerMesh}
                                        serialService={serialService}
                                      />
                                    </UplinkLoadGate>
                                  </SerialDeviceProvider>
                                </CoverageMaskCacheProvider>
                              </PushHostProvider>
                            </GoNoGoHostProvider>
                          </MissionProfilesProvider>
                        </RootProviders>
                      </ManeuverTriggerProvider>
                    </CommcastLogProviderOrPassthrough>
                  </ScopedStationIdentity>
                </OptionalNotesHost>
              </WarpIntentProvider>
            </AlarmHostProvider>
          </ReplaySessionProvider>
        </SettingsProvider>
      </ScreenProvider>
    </SitrepTelemetryProvider>
  );
}

/**
 * The scene-keyed dashboard and everything that edits it.
 *
 * Split out of `MainScreen` because the scene is a telemetry read, and
 * `MainScreen` renders the `SitrepTelemetryProvider` rather than sitting under
 * it: read there, the scene never left `"Unknown"`, so the screen stayed on
 * the base layout in every scene.
 */
function MainDashboard({
  screen,
  hosting,
  serialService,
}: {
  screen: Screen;
  hosting: boolean;
  serialService: SerialDeviceService;
}) {
  const { scene, inFlight, hasGameSignal } = useGameContext();
  const profiles = useMissionProfilesService();
  const { dashboard, controller } = useProfileDashboard(
    profiles,
    EMPTY_DASHBOARD,
  );

  useEffect(() => {
    const dispatcher = new InputDispatcher({
      service: serialService,
      getItems: () => [...dashboard.getItems(), voteInputSource(screen)],
      ...profileInputOptions(profiles, controller, serialService),
    });
    return () => {
      dispatcher.dispose();
    };
  }, [serialService, dashboard.getItems, profiles, controller, screen]);

  return (
    <ProfileOverlayProvider dashboard={dashboard}>
      <DashboardShortcuts history={controller} />
      <MainAlarmsLauncherScope>
        <Layout as="main" aria-label="Mission control">
          <UplinkIntegrityBanner />
          <MissionBanner
            centre={<PollCentre screen={screen} hosting={hosting} />}
            centreControls={
              screen === "main" && hosting ? <PollSettingsControl /> : undefined
            }
            actions={
              <>
                <LayoutHistoryControl dashboard={controller} />
                <HelpButton />
              </>
            }
          />
          {screen === "pilot" && !inFlight ? (
            <NoActiveVessel hasGameSignal={hasGameSignal} scene={scene} />
          ) : null}
          <ProfileDashboardProvider value={controller}>
            <Dashboard
              items={dashboard.items}
              layout={dashboard.layout}
              onLayoutChange={dashboard.handleLayoutChange}
              updateItemConfig={dashboard.updateItemConfig}
              updateItemMappings={dashboard.updateItemMappings}
              updateItemMobileWidth={dashboard.updateItemMobileWidth}
              updateItemMobileHeight={dashboard.updateItemMobileHeight}
              removeItem={dashboard.removeItem}
              moveItemUp={dashboard.moveItemUp}
              moveItemDown={dashboard.moveItemDown}
              lastAddedId={dashboard.lastAddedId}
              clearLastAdded={dashboard.clearLastAdded}
            />
          </ProfileDashboardProvider>
          <FabClusterProvider>
            <ComponentOverlay />
            <FlightsFabWithMissionHistory />
            <SerialPortRecoveryWatcher />
            <LocalLinkFab />
            <FullscreenFab bottom={264} />
            <SettingsFab bottom={324} />
            <MissionProfilesFab bottom={384} dashboard={controller} />
            <MainAlarmsFab />
          </FabClusterProvider>
          <ReplaySessionBanner />
          <BannerStack>
            {/* BannerStack is row-reverse,
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
            <AlarmsCancelledPill />
            <HeaderBadges />
            <SignalLossIndicator />
            <SustainedFailureBanner />
            <SceneChangeBanner />
            <FlightOutcomeBanner />
            <ContactLossBanner />
            <HomeFallbackNotice />
            <ModVersionBanner />
            {hosting && (
              <>
                <StationBuildMismatchNotice host={peerHostService} />
                <StationApprovalPrompt host={peerHostService} />
              </>
            )}
            <SceneSwitchPrompt dashboard={controller} />
            <ProfileSwitchBanner dashboard={controller} />
          </BannerStack>
          <PushedDashboardOverlay />
        </Layout>
      </MainAlarmsLauncherScope>
    </ProfileOverlayProvider>
  );
}

/**
 * The header's GO/NO-GO: the host's view of the poll at its centre, or on a
 * mission-control screen that joined another host, its own vote. A pilot has
 * no poll.
 */
function PollCentre({ screen, hosting }: { screen: Screen; hosting: boolean }) {
  if (screen === "pilot") return null;
  return hosting ? <MainPollHeader /> : <StationPollControl />;
}

/** The join code's button, on a local screen: one that hosts or joins by itself. */
function LocalLinkFab() {
  return useHostRole() ? <StationLinkFab /> : null;
}

/** Provides the notes the host keeps, or nothing on a screen that reads them from a host. */
function OptionalNotesHost({
  service,
  children,
}: {
  service: NonNullable<ReturnType<typeof useHostingHosts>>["notesHost"];
  children: ReactNode;
}) {
  if (!service) return <>{children}</>;
  return <NotesHostProvider service={service}>{children}</NotesHostProvider>;
}

/**
 * Tells the host who this joined local screen is and the centre it stands at,
 * which the host cannot see, since this screen reads the game over its own
 * connection.
 */
function JoinedScreenInfo({
  client,
  screen,
}: {
  client: PeerClientService;
  screen: Screen;
}) {
  const centre = useHostCentre();
  return (
    <StationInfoBroadcaster
      client={client}
      seat={screen === "pilot" ? "pilot" : "mission-control"}
      centre={screen === "pilot" ? undefined : centre}
    />
  );
}

/**
 * `FlightsFab` needs the resolved mission-history settings, but
 * `@ksp-gonogo/data` (where it lives) has no access to `@ksp-gonogo/app`'s
 * `SettingsService`: this tiny wrapper bridges the two, and must be
 * rendered inside `<SettingsProvider>` (unlike `MainScreen` itself, which
 * constructs the `SettingsService` instance but sits outside its own
 * provider's subtree).
 */
function FlightsFabWithMissionHistory() {
  const { missionHistoryEnabled, recordAllTopics } =
    useMissionHistorySettings();
  return (
    <FlightsFab
      missionHistoryEnabled={missionHistoryEnabled}
      recordAllTopics={recordAllTopics}
    />
  );
}

/**
 * Renders nothing, mounts `AutoRecordController`, the auto-record
 * lifecycle (see that component's own doc comment for the flight-boundary
 * approach), for the app's lifetime. Same settings-bridging need as
 * `FlightsFabWithMissionHistory` above: `@ksp-gonogo/data` has no access to
 * this app's `SettingsService`.
 *
 * Deliberately main-only by construction: this is only ever rendered from
 * `MainScreen`'s own JSX, never `StationScreen`'s: there is no separate
 * `isMain` gate to get wrong.
 */
function AutoRecordControllerWithMissionHistory() {
  const { scene } = useGameContext();
  const { missionHistoryEnabled, recordAllTopics, videoRecordingEnabled } =
    useMissionHistorySettings();
  return (
    <AutoRecordController
      missionHistoryEnabled={missionHistoryEnabled}
      recordAllTopics={recordAllTopics}
      videoRecordingEnabled={videoRecordingEnabled}
      scene={scene}
    />
  );
}

/**
 * Closure-based snapshot hook so the modal works without needing
 * AlarmHostContext in its ancestor tree: ModalProvider mounts portaled
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
      bottom={444}
      useSnapshot={bindings.useSnapshot}
      onAdd={bindings.onAdd}
      onUpdate={bindings.onUpdate}
      onDelete={bindings.onDelete}
      ModalComponent={AlarmsModal}
    />
  );
}

const Layout = styled.div`
  padding: var(--gutter-screen);
  padding-top: calc(var(--gutter-screen) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(var(--gutter-screen) + env(safe-area-inset-bottom, 0px));
  padding-left: calc(var(--gutter-screen) + env(safe-area-inset-left, 0px));
  padding-right: calc(var(--gutter-screen) + env(safe-area-inset-right, 0px));
  background: var(--color-surface-app);
  min-height: 100vh;
`;
