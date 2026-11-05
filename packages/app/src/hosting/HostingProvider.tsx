import { PerfBudget } from "@ksp-gonogo/core";
import {
  DelayAuthority,
  type DelaySubscribable,
  TelemetryClient,
  type Transport,
  useTelemetryClientOptional,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createAlarmHost } from "../alarms";
import { GoNoGoHostService } from "../goNoGo";
import { createManeuverTriggerHost } from "../maneuverTriggers";
import { createNotesHost } from "../notes/createNotesHost";
import { HostCommandCentreAnnouncer } from "../peer/HostCommandCentreAnnouncer";
import { peerHostService } from "../peer/PeerHostService";
import { PushHostService } from "../pushToMain/PushHostService";
import { HostRatePacer } from "../telemetry/HostRatePacer";
import { SitrepPeerRelay } from "../telemetry/SitrepPeerRelay";
import { SitrepVantageSessions } from "../telemetry/SitrepVantageSessions";
import {
  getSitrepHostConfig,
  getSitrepReconnectNonce,
  subscribeSitrepHostConfig,
  subscribeSitrepReconnectNonce,
} from "../telemetry/sitrepRuntime";
import { HostUplinksAnnouncer } from "../uplinks/HostUplinksAnnouncer";
import { HostJobs, registerHostJobs } from "./HostJobs";

/**
 * Frames arriving on the host's jobs connection. It holds the alarm roster and
 * the delay Topics and nothing a widget asked for, so it sits far under the
 * display's own stream; a run past this is a subscription that was duplicated.
 */
const HOST_JOBS_STREAM_BUDGET = new PerfBudget({
  name: "Host jobs stream frames/sec",
  threshold: 300,
  windowMs: 1000,
  unit: "frames",
});

/**
 * Open the jobs connection's transport to the mod at `host` and `port`.
 * Replaceable so a test can drive the connection without a socket, the same
 * seam `SitrepTelemetryProvider` offers for its own transport.
 */
export type OpenJobsTransport = (host: string, port: number) => Transport;

const openLiveJobsTransport: OpenJobsTransport = (host, port) =>
  new WebSocketTransport({
    host,
    port,
    onStreamFrame: () => HOST_JOBS_STREAM_BUDGET.record(),
  }) as Transport;

export interface MainHosts {
  goNoGoHost: GoNoGoHostService;
  pushHost: PushHostService;
  /** `null` on a page that joins a host: its alarms and notes are the host's, read over the peer link. */
  alarmHost: ReturnType<typeof createAlarmHost> | null;
  notesHost: ReturnType<typeof createNotesHost> | null;
  maneuverTriggerHost: ReturnType<typeof createManeuverTriggerHost>;
}

interface HostingValue {
  hosts: MainHosts;
  jobs: HostJobs;
}

const HostingContext = createContext<HostingValue | null>(null);

/** The host services of the hosting piece mounted above, or `null` outside one. */
export function useHostingHosts(): MainHosts | null {
  return useContext(HostingContext)?.hosts ?? null;
}

/**
 * Open the host's jobs connection to the mod and keep it in `jobs`.
 *
 * Built apart from the screen's display session on purpose, and never given a
 * vantage: the mod places a connection that has not chosen at the home command
 * centre, so the hosting jobs stay there however the screen's picker moves.
 * Host and port follow the saved connection settings the display follows, so a
 * change to them reconnects both.
 */
export function useHostJobsConnection(
  jobs: HostJobs,
  enabled: boolean,
  openTransport: OpenJobsTransport = openLiveJobsTransport,
): void {
  const { host, port } = useSyncExternalStore(
    subscribeSitrepHostConfig,
    getSitrepHostConfig,
    getSitrepHostConfig,
  );
  const reconnectNonce = useSyncExternalStore(
    subscribeSitrepReconnectNonce,
    getSitrepReconnectNonce,
    getSitrepReconnectNonce,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectNonce has no use in the body, bumping it must rebuild the connection when host and port are unchanged.
  useEffect(() => {
    if (!enabled) return;
    const transport = openTransport(host, port);
    const client = new TelemetryClient(transport);

    /*
     * The delay a command is expected to take is the delay of the centre it
     * leaves from. A station's command leaves from the centre the host's screen
     * shows it, which this connection does not stand at, so the authority is
     * told that centre rather than reading the connection's own.
     */
    const standingAt: DelaySubscribable = {
      subscribe: (topic, cb) => client.subscribe(topic, cb),
      get selectedVantage() {
        return jobs.plainStationVantage() || undefined;
      },
      get observedVantage() {
        return client.observedVantage;
      },
    };
    const authority = new DelayAuthority();
    const detachAuthority = authority.attach(standingAt);
    const clearDelaySource = client.setDelaySource(authority.delaySeconds);

    jobs.setClient(client);
    return () => {
      jobs.setClient(undefined);
      clearDelaySource();
      detachAuthority();
      client.dispose();
    };
  }, [jobs, enabled, host, port, reconnectNonce, openTransport]);
}

/**
 * Everything only a host does, apart from the screen that happens to host.
 *
 * It owns the host services (votes, pushes, alarms, notes, maneuver triggers),
 * the jobs connection at the home command centre that those services and every
 * Uplink's host handle send through, and the one mod session per vantage a
 * remote station has asked to read from. The screen's own display is a separate
 * local reader mounted beneath this, exactly as any local screen reads the game;
 * `PlainStationFeed` is the one place the two meet.
 *
 * `ownsMesh` is false on a page that joins the mesh as a client: it builds the
 * votes, pushes and maneuver triggers its widgets read and holds no connection
 * of its own, so its commands go through its display session. It builds no
 * alarm or notes service, since both live on the host.
 *
 * Children render once the services exist, and read them with
 * `useHostingHosts`.
 */
export function HostingProvider({
  ownsMesh,
  seat = "main",
  jobs: givenJobs,
  openTransport = openLiveJobsTransport,
  children,
}: {
  ownsMesh: boolean;
  /**
   * Where the hosting screen sits. A pilot's screen stands at no command
   * centre, so the stations that chose none read from home and it shows no
   * poll.
   */
  seat?: "main" | "pilot";
  /** The jobs link of a screen that already holds its connection to the game. */
  jobs?: HostJobs;
  openTransport?: OpenJobsTransport;
  children: ReactNode;
}) {
  const [ownJobs] = useState(() => new HostJobs());
  const jobs = givenJobs ?? ownJobs;
  const [hosts, setHosts] = useState<MainHosts | null>(null);

  useHostJobsConnection(jobs, ownsMesh && !givenJobs, openTransport);

  useEffect(() => {
    if (!ownsMesh || seat !== "pilot") return;
    return peerHostService.servePlainStationsAtHome();
  }, [ownsMesh, seat]);

  useEffect(() => {
    if (!ownsMesh) return;
    const releaseRegistry = registerHostJobs(jobs);
    const releasePeerHost = peerHostService.attachHostJobs(jobs);
    return () => {
      releasePeerHost();
      releaseRegistry();
    };
  }, [jobs, ownsMesh]);

  /*
   * The services subscribe to the peer host in their constructors, so they are
   * built in an effect and disposed with it: a useState initialiser runs twice
   * under StrictMode and the spare would stay subscribed, sending every stage
   * and countdown twice.
   */
  useEffect(() => {
    const built: MainHosts = {
      goNoGoHost: new GoNoGoHostService(peerHostService, {
        hostCentre: () =>
          seat === "pilot" ? null : (peerHostService.getCommandCentre() ?? ""),
        commandFrom: (centre) =>
          ownsMesh ? jobs.commandClientAt(centre) : undefined,
      }),
      pushHost: new PushHostService(peerHostService),
      alarmHost: ownsMesh
        ? createAlarmHost(peerHostService, { hostJobs: jobs })
        : null,
      notesHost: ownsMesh ? createNotesHost(peerHostService) : null,
      maneuverTriggerHost: createManeuverTriggerHost(peerHostService),
    };
    setHosts(built);
    return () => {
      built.goNoGoHost.dispose();
      built.pushHost.dispose();
      built.alarmHost?.dispose();
      built.notesHost?.dispose();
      built.maneuverTriggerHost.dispose();
      setHosts(null);
    };
  }, [jobs, ownsMesh, seat]);

  if (!hosts) return null;
  return (
    <HostingContext.Provider value={{ hosts, jobs }}>
      {ownsMesh && (
        <>
          <SitrepVantageSessions peerHost={peerHostService} />
          <HostUplinksAnnouncer host={peerHostService} />
          {seat === "pilot" && <HomeCentreAnnouncer jobs={jobs} />}
        </>
      )}
      {children}
    </HostingContext.Provider>
  );
}

/**
 * Serves the hosting screen's own display session to every station that chose
 * no centre of its own, and names that session to the host's jobs so a command
 * such a station sends leaves from the centre it is being shown.
 *
 * Mount inside the screen's display provider: the stations read what that
 * session reads, so they follow the screen's picker. Renders nothing.
 */
export function PlainStationFeed({
  ownsMesh,
  seat = "main",
}: {
  ownsMesh: boolean;
  seat?: "main" | "pilot";
}) {
  const jobs = useContext(HostingContext)?.jobs;
  const client = useTelemetryClientOptional();
  const servesPlainStations = ownsMesh && seat === "main";

  useEffect(() => {
    if (!jobs || !client || !servesPlainStations) return;
    return jobs.attachPlainStationSession(client);
  }, [jobs, client, servesPlainStations]);

  /*
   * A station's command is dispatched on the jobs connection, so its answer
   * and its loss are recorded there; the screen's own client is told where to
   * read them for the rows it draws.
   */
  useEffect(() => {
    if (!jobs || !client || !ownsMesh) return;
    let release: (() => void) | undefined;
    const carry = () => {
      release?.();
      const carrier = jobs.client;
      release = carrier ? client.carryCommandsFrom(carrier) : undefined;
    };
    carry();
    const stop = jobs.onClientChange(carry);
    return () => {
      stop();
      release?.();
    };
  }, [jobs, client, ownsMesh]);

  return (
    <>
      <SitrepPeerRelay peerHost={peerHostService} />
      <HostRatePacer />
      {servesPlainStations && (
        <HostCommandCentreAnnouncer host={peerHostService} />
      )}
    </>
  );
}

/**
 * Tells the peer mesh that the host stands at the home command centre, for a
 * pilot host, whose own screen is aboard a craft. The centre is the one the
 * mod stamps the jobs connection's frames with, since that connection never
 * chooses one.
 */
function HomeCentreAnnouncer({ jobs }: { jobs: HostJobs }) {
  const client = useSyncExternalStore(
    (cb) => jobs.onClientChange(cb),
    () => jobs.client,
    () => jobs.client,
  );
  const home = useSyncExternalStore(
    (cb) => client?.onObservedVantageChange(cb) ?? (() => {}),
    () => client?.observedVantage ?? null,
    () => client?.observedVantage ?? null,
  );
  useEffect(() => {
    peerHostService.setCommandCentre(home);
  }, [home]);
  return null;
}
