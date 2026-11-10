import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  BroadcastIcon,
  Button,
  Fab,
  StatusIndicator,
  useModal,
} from "@ksp-gonogo/ui";
import { Cluster, Tooltip } from "@ksp-gonogo/ui-kit";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { SETUP_LINKS } from "../firstRun/setupGuide";
import { useHostRole, useHostRoleState } from "../hosting/HostRoleContext";
import {
  CONNECTION_PATH_LABEL,
  type ConnectionPath,
} from "../peer/connectionPath";
import type { EndpointStatus } from "../peer/endpointStations";
import { peerHostService } from "../peer/PeerHostService";
import { relayBaseUrl } from "../peer/relayAddress";
import { requestSettings } from "../settings/settingsRequest";
import { ApprovedStations } from "../stationApproval/ApprovedStations";
import { StationApprovalPrompt } from "../stationApproval/StationApprovalPrompt";
import { CHANNEL } from "../version";
import { inviteAddress } from "./inviteAddress";

/** Between Add widget (84) and the next FAB up (144), so Invite sits just above Add widget, or next to the menu toggle on a seat without it. */
const INVITE_BOTTOM = 114;

/**
 * The Invite button, on every seat: the one address that joins this game,
 * its QR code and the code in large type, so anyone already in can bring in
 * the next person. On the host it also holds what joining depends on: the
 * requests waiting for approval, the stations approved, the path each
 * connection took and a fresh code.
 *
 * `code` is the game's code on a screen that joined by it; a local screen
 * reads it from its host role instead.
 */
export function InviteFab({
  code,
  bottom = INVITE_BOTTOM,
}: {
  code?: string;
  bottom?: number;
}) {
  const { open } = useModal();
  return (
    <Tooltip text="Invite">
      <Fab
        bottom={bottom}
        onClick={() => open(<InvitePanel code={code} />, { title: "Invite" })}
        aria-label="Invite"
      >
        <BroadcastIcon />
      </Fab>
    </Tooltip>
  );
}

function InvitePanel({ code }: { code?: string }) {
  const role = useHostRoleState();
  if (code) return <InviteBlock code={code} />;
  if (role.kind === "joined") return <InviteBlock code={role.record.code} />;
  return <HostLinkPanel />;
}

/** The join address for `code`, its QR code and the code itself. */
function InviteBlock({ code }: { code: string }) {
  const address = inviteAddress({
    code,
    origin: globalThis.location.origin,
    baseUrl: import.meta.env.BASE_URL,
    channel: CHANNEL,
    override: import.meta.env.VITE_APP_URL,
  });
  return (
    <Wrap>
      <Code aria-label={`Join code ${code.split("").join(" ")}`}>{code}</Code>
      <QrRow>
        <QRCodeSVG
          value={address}
          size={180}
          title="QR code for the join address"
        />
      </QrRow>
      <Address href={address} target="_blank" rel="noreferrer">
        {address}
      </Address>
    </Wrap>
  );
}

function HostLinkPanel() {
  // The modal portal renders outside the PeerHostProvider subtree, so the
  // usePeerHost() context hook would always return null in here. Subscribe
  // to the service singleton directly: it already drives the provider's
  // state, so this sees the same value without relying on React context.
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);
  // The game's join code. Both the QR and the typed value are this code; the
  // station derives the broker peer id (`gonogo-host-<code>`) from it.
  const [shareCode, setShareCode] = useState(peerHostService.shareCode);
  // True while the host is retry-reclaiming its derived id after an unclean
  // restart (the broker still holds the stale slot). Surfaced as a status so
  // the operator knows why a just-restarted host isn't accepting stations yet.
  const [reclaiming, setReclaiming] = useState(peerHostService.isReclaiming());
  useEffect(() => {
    const unsubId = peerHostService.onPeerIdChange(setPeerId);
    const unsubShareCode = peerHostService.onShareCodeChange(setShareCode);
    const unsubReclaim = peerHostService.onReclaimingChange(setReclaiming);
    return () => {
      unsubId();
      unsubShareCode();
      unsubReclaim();
    };
  }, []);

  /* While reclaiming, the broker has not confirmed the derived id (peerId is
     null) but the join code is valid, so it is shown with its status and the
     operator can already share the link; joining screens retry until the host
     is back. */
  if (!peerId && !reclaiming) {
    return (
      <Wrap>
        <StationApprovalPrompt host={peerHostService} inPanel />
        <Empty>Connecting to peer network...</Empty>
      </Wrap>
    );
  }

  return (
    <Wrap>
      {/* The banner strip sits under the modal overlay, so a request is answered here while the panel is open. */}
      <StationApprovalPrompt host={peerHostService} inPanel />
      {reclaiming && (
        <StatusIndicator tone="info" live>
          Reclaiming your join code after an unexpected restart, stations
          reconnect automatically.
        </StatusIndicator>
      )}
      <InviteBlock code={shareCode} />
      <EndpointState />
      <StationPaths />
      <Cluster>
        <Label>Approved screens</Label>
      </Cluster>
      <ApprovedStations />
      <RegenerateRow />
    </Wrap>
  );
}

/**
 * Two-step button: idle → "New join code" → "Confirm" → asks the game for a
 * fresh join code, which the host then re-claims its broker id under. The old
 * code stops working and every live station channel drops, so stations must be
 * re-shared the new code. Also the recovery path when a host can't reclaim a
 * stuck broker slot.
 */
function RegenerateRow() {
  const role = useHostRole();
  const [phase, setPhase] = useState<"idle" | "confirming" | "running">("idle");

  useEffect(() => {
    if (phase !== "confirming") return;
    const reset = setTimeout(() => setPhase("idle"), 4000);
    return () => clearTimeout(reset);
  }, [phase]);

  async function run() {
    setPhase("running");
    try {
      await role?.regenerateCode();
    } finally {
      setPhase("idle");
    }
  }

  return (
    <RegenerateWrap>
      {phase === "idle" && (
        <Button
          variant="ghost"
          type="button"
          onClick={() => setPhase("confirming")}
        >
          New join code
        </Button>
      )}
      {phase === "confirming" && (
        <Button variant="ghost" type="button" onClick={run}>
          Confirm: old code stops working
        </Button>
      )}
      {phase === "running" && (
        <Button variant="ghost" type="button" disabled>
          Generating...
        </Button>
      )}
      <RegenerateHint>
        Mints a fresh join code. The old code stops working, anyone who had it
        (including connected stations once they drop) needs the new code shown
        above.
      </RegenerateHint>
    </RegenerateWrap>
  );
}

/**
 * One row per connected station with the path its connection actually took
 * (direct on the same network, direct over the internet, or relayed), read
 * from the browser's selected candidate pair.
 */
function StationPaths() {
  const [rows, setRows] = useState(() => peerHostService.getStationPaths());
  useEffect(
    () =>
      peerHostService.onStationPathsChange(() =>
        setRows(peerHostService.getStationPaths()),
      ),
    [],
  );
  if (rows.length === 0) return null;
  return (
    <PathList aria-label="Station connection paths">
      {rows.map((row) => (
        <PathRow key={row.peerId}>
          <span>{row.name ?? row.peerId}</span>
          <Badge tone={pathTone(row.path)} size="sm">
            {pathText(row.path)}
          </Badge>
        </PathRow>
      ))}
    </PathList>
  );
}

function pathTone(path: ConnectionPath | null): Tone {
  if (path === "lan") return "go";
  if (path === "internet") return "info";
  return "neutral";
}

function pathText(path: ConnectionPath | null): string {
  return path ? CONNECTION_PATH_LABEL[path] : "path unknown";
}

/**
 * What stops stations on other networks joining: the relay not running,
 * another main screen holding it, or its port not opened on the router. Shows nothing once the relay has had the
 * router open it. A port forwarded by hand cannot be seen from here, so that
 * case reads the same as no forward. Read again every 30 s while the window is
 * open.
 */
function EndpointState() {
  const [status, setStatus] = useState<EndpointStatus | null>(
    peerHostService.endpoint.status,
  );
  const [held, setHeld] = useState(peerHostService.endpoint.heldElsewhere);
  const opened = usePortOpened();
  useEffect(
    () =>
      peerHostService.endpoint.onAvailable(() =>
        setStatus(peerHostService.endpoint.status),
      ),
    [],
  );
  useEffect(() => peerHostService.endpoint.onHeldElsewhere(setHeld), []);

  if (held) {
    return (
      <StatusIndicator tone="warn" live>
        Another main screen is serving stations. Close it and this one takes
        over.
      </StatusIndicator>
    );
  }
  if (!status) {
    return (
      <StatusIndicator tone="warn" live>
        The relay is not running, so only devices on this network can join.{" "}
        <GuideLink
          href={SETUP_LINKS.relayPorts}
          target="_blank"
          rel="noreferrer"
        >
          Networking guide
        </GuideLink>
      </StatusIndicator>
    );
  }
  if (opened) return null;
  return (
    <StatusIndicator tone="info" live>
      Stations on this network can join. For other networks, see{" "}
      <SettingLink type="button" onClick={() => requestSettings("general")}>
        Automatic port forwarding
      </SettingLink>{" "}
      in Settings, under Relay.
    </StatusIndicator>
  );
}

/** Whether the relay reports, in `/health`, that the router opened its port. */
function usePortOpened(): boolean {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const read = () =>
      fetch(`${relayBaseUrl()}/health`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body: unknown) => {
          const m =
            typeof body === "object" && body !== null
              ? Reflect.get(body, "portMapping")
              : null;
          setOpened(
            !!m &&
              typeof m === "object" &&
              Reflect.get(m, "state") === "mapped",
          );
        })
        .catch(() => {});
    void read();
    const interval = setInterval(read, 30_000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, []);
  return opened;
}

const PathList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  color: var(--color-text-primary);
`;

const GuideLink = styled.a`
  color: var(--color-info-text);
  text-decoration: underline;
`;

/* A button that reads as the link beside it, inside a sentence. */
const SettingLink = styled.button`
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--color-info-text);
  text-decoration: underline;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const PathRow = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
`;

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 260px;
  color: var(--color-text-primary);
`;

const Label = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

/* Display tier, read aloud or from across a room: the type scale stops at --font-size-lg, so this is set as a page-scale size. */
const Code = styled.code`
  align-self: center;
  color: var(--color-info-text);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 0.15em;
`;

const Address = styled.a`
  align-self: center;
  color: var(--color-info-text);
  font-size: var(--font-size-value);
  word-break: break-all;
  text-decoration: underline;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const QrRow = styled.div`
  display: flex;
  justify-content: center;
  align-self: center;
  padding: var(--inset-qr);
  background: var(--color-text-primary);
  border-radius: var(--radius-regular);
`;

const Empty = styled.div`
  padding: var(--inset-empty-popover);
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  text-align: center;
`;

const RegenerateWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  border-top: 1px solid var(--color-border-subtle);
  padding-top: var(--gap-popover-section);
`;

const RegenerateHint = styled.p`
  margin: 0;
  font-size: var(--font-size-prose);
  color: var(--color-text-muted);
  line-height: var(--line-height-prose);
`;
