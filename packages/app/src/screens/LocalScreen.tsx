import { logger } from "@ksp-gonogo/logger";
import { Button, LiveRegion, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import { useFollowHostAnalytics } from "../analytics/useFollowHostAnalytics";
import { StationSupersededNotice } from "../components/StationSupersededNotice";
import {
  type OpenJobsTransport,
  useHostJobsConnection,
} from "../hosting/HostingProvider";
import { HostJobs } from "../hosting/HostJobs";
import { HostRole, type HostRoleState } from "../hosting/HostRole";
import { HostRoleProvider, registerHostRole } from "../hosting/HostRoleContext";
import { TakeoverNotice } from "../hosting/TakeoverNotice";
import { acquireTabToken, type TabToken } from "../hosting/tabToken";
import { WaitingForGame } from "../hosting/WaitingForGame";
import { ModApprovalBook } from "../peer/approvalBook";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostProvider } from "../peer/PeerHostProvider";
import { peerHostService } from "../peer/PeerHostService";
import { StationApprovalNotice } from "../stationApproval/StationApprovalNotice";
import { ScopedStationIdentity } from "../stationIdentity";
import { MainScreen } from "./MainScreen";

type Seat = "main" | "pilot";

const WAITING: HostRoleState = { kind: "waiting" };

/**
 * Hold this tab's host role over `jobs`' connection to the game: claim it with
 * the tab's own token and follow the connection when it is replaced. `null`
 * until the token is known.
 *
 * Nothing gives the role up as the page goes: a page going away cannot tell a
 * reload from a close, and a reloaded tab takes the role straight back with its
 * own token inside the grace. A closed tab is let go when the grace runs out.
 */
function useHostRoleOver(
  jobs: HostJobs,
  acquireToken: () => Promise<TabToken>,
): HostRole | null {
  const [role, setRole] = useState<HostRole | null>(null);

  useEffect(() => {
    let live = true;
    let made: HostRole | undefined;
    let release: (() => void) | undefined;
    void acquireToken().then((tab) => {
      release = tab.release;
      if (!live) {
        tab.release();
        return;
      }
      made = new HostRole(tab.token);
      setRole(made);
    });
    return () => {
      live = false;
      made?.dispose();
      release?.();
      setRole(null);
    };
  }, [acquireToken]);

  const client = useSyncExternalStore(
    (cb) => jobs.onClientChange(cb),
    () => jobs.client,
    () => jobs.client,
  );
  useEffect(() => {
    if (!role || !client) return;
    return role.attach(client);
  }, [role, client]);

  useEffect(() => (role ? registerHostRole(role) : undefined), [role]);

  return role;
}

/**
 * A screen at `/` or `/pilot`: one that reads the game over its own connection,
 * and hosts the peer mesh or joins the screen that does, by itself.
 *
 * It shows that it is waiting for the game until the mod answers, and never
 * asks for a code. Then it claims the host role: granted, it hosts; refused, it
 * joins the holder's code. When the host goes, it claims again and the mod
 * decides which screen takes over. A host told it no longer holds the role
 * stops hosting at once and joins.
 */
export function LocalScreen({
  seat,
  openTransport,
  acquireToken = acquireTabToken,
}: {
  seat: Seat;
  /** Opens the screen's connection to the game; a socket to the mod unless a test stands one in. */
  openTransport?: OpenJobsTransport;
  /** This tab's host token; the one kept in this tab's session storage unless a test stands one in. */
  acquireToken?: () => Promise<TabToken>;
}) {
  const [jobs] = useState(() => new HostJobs());
  useHostJobsConnection(jobs, true, openTransport);
  const role = useHostRoleOver(jobs, acquireToken);
  const state = useSyncExternalStore(
    (cb) => role?.subscribe(cb) ?? (() => {}),
    () => role?.state ?? WAITING,
    () => role?.state ?? WAITING,
  );

  useEffect(() => {
    document.title = seat === "pilot" ? "gonogo - Pilot" : "gonogo - Main";
  }, [seat]);

  if (!role || state.kind === "waiting") return <WaitingForGame />;

  return (
    <HostRoleProvider role={role}>
      {state.kind === "hosting" ? (
        <HostingLocalScreen
          key="hosting"
          seat={seat}
          role={role}
          jobs={jobs}
          code={state.record.code}
          takeover={state.takeover}
        />
      ) : (
        <JoinedLocalScreen key="joined" seat={seat} code={state.record.code} />
      )}
    </HostRoleProvider>
  );
}

function HostingLocalScreen({
  seat,
  role,
  jobs,
  code,
  takeover,
}: {
  seat: Seat;
  role: HostRole;
  jobs: HostJobs;
  code: string;
  takeover: boolean;
}) {
  const [takenOver] = useState(takeover);
  useEffect(
    () => peerHostService.attachApprovals(new ModApprovalBook(role)),
    [role],
  );
  useEffect(() => {
    logger.setIdentity({ role: "host" });
  }, []);
  return (
    <PeerHostProvider code={code}>
      {takenOver && <TakeoverNotice />}
      <MainScreen screen={seat} hosting jobs={jobs} />
    </PeerHostProvider>
  );
}

type ConnStatus = Parameters<
  Parameters<PeerClientService["onConnectionStatus"]>[0]
>[0];

/**
 * A local screen while another screen hosts: its own view of the game, with
 * the shared thread, votes and roster over the peer link to the host, joined
 * with the code from the game's record.
 */
function JoinedLocalScreen({ seat, code }: { seat: Seat; code: string }) {
  const [client] = useState(() => new PeerClientService());
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [hostNotFound, setHostNotFound] = useState(false);

  useEffect(() => {
    logger.setIdentity({ role: seat === "pilot" ? "pilot" : "station" });
  }, [seat]);

  useFollowHostAnalytics(client);

  useEffect(() => {
    setHostNotFound(false);
    const unsubs = [
      client.onConnectionStatus((s) => {
        setStatus(s);
        if (s === "connected") setHostNotFound(false);
      }),
      client.onHostUnavailable(() => setHostNotFound(true)),
    ];
    client.connect(code);
    return () => {
      for (const u of unsubs) u();
      client.disconnect();
    };
  }, [client, code]);

  const linkText =
    status === "connected"
      ? ""
      : hostNotFound
        ? `No host answering on ${code}`
        : `Reaching the host (${code}): ${status}`;

  return (
    <ScopedStationIdentity
      defaultName={seat === "pilot" ? "Pilot" : "Mission Control"}
    >
      <PeerClientProvider client={client}>
        <StationSupersededNotice client={client} />
        <StationApprovalNotice client={client} />
        <LiveRegion visuallyHidden>{linkText}</LiveRegion>
        {linkText && (
          <JoinedLocalScreen__Banner>
            <Text size="xs" tone="warn">
              {linkText}
            </Text>
            <Button onClick={() => client.connect(code)}>Retry</Button>
          </JoinedLocalScreen__Banner>
        )}
        <MainScreen screen={seat} hosting={false} joinedVia={client} />
      </PeerClientProvider>
    </ScopedStationIdentity>
  );
}

/** Non-blocking: the instruments are this screen's own and keep working without the host. */
const JoinedLocalScreen__Banner = styled.div`
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
