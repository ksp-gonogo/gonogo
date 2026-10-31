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
  alarmHost: ReturnType<typeof createAlarmHost>;
  notesHost: ReturnType<typeof createNotesHost>;
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
function useHostJobsConnection(
  jobs: HostJobs,
  enabled: boolean,
  openTransport: OpenJobsTransport,
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
 * services its widgets read and holds no connection of its own, so its alarms
 * and commands go through its display session as they always have.
 *
 * Children render once the services exist, and read them with
 * `useHostingHosts`.
 */
export function HostingProvider({
  ownsMesh,
  openTransport = openLiveJobsTransport,
  children,
}: {
  ownsMesh: boolean;
  openTransport?: OpenJobsTransport;
  children: ReactNode;
}) {
  const [jobs] = useState(() => new HostJobs());
  const [hosts, setHosts] = useState<MainHosts | null>(null);

  useHostJobsConnection(jobs, ownsMesh, openTransport);

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
      goNoGoHost: new GoNoGoHostService(peerHostService),
      pushHost: new PushHostService(peerHostService),
      alarmHost: createAlarmHost(peerHostService, {
        hostJobs: ownsMesh ? jobs : undefined,
      }),
      notesHost: createNotesHost(peerHostService),
      maneuverTriggerHost: createManeuverTriggerHost(peerHostService),
    };
    setHosts(built);
    return () => {
      built.goNoGoHost.dispose();
      built.pushHost.dispose();
      built.alarmHost.dispose();
      built.notesHost.dispose();
      built.maneuverTriggerHost.dispose();
      setHosts(null);
    };
  }, [jobs, ownsMesh]);

  if (!hosts) return null;
  return (
    <HostingContext.Provider value={{ hosts, jobs }}>
      {ownsMesh && (
        <>
          <SitrepVantageSessions peerHost={peerHostService} />
          <HostUplinksAnnouncer host={peerHostService} />
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
export function PlainStationFeed({ ownsMesh }: { ownsMesh: boolean }) {
  const jobs = useContext(HostingContext)?.jobs;
  const client = useTelemetryClientOptional();

  useEffect(() => {
    if (!jobs || !client || !ownsMesh) return;
    return jobs.attachPlainStationSession(client);
  }, [jobs, client, ownsMesh]);

  return (
    <>
      <SitrepPeerRelay peerHost={peerHostService} />
      <HostRatePacer />
      {ownsMesh && <HostCommandCentreAnnouncer host={peerHostService} />}
    </>
  );
}
