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
import { useEffect, useState } from "react";
import styled from "styled-components";
import { SETUP_LINKS } from "../firstRun/setupGuide";
import {
  CONNECTION_PATH_LABEL,
  type ConnectionPath,
} from "../peer/connectionPath";
import type { EndpointStatus } from "../peer/endpointStations";
import { peerHostService } from "../peer/PeerHostService";
import { relayBaseUrl } from "../peer/relayAddress";
import { requestSettings } from "../settings/settingsRequest";
import { StationApprovalPrompt } from "../stationApproval/StationApprovalPrompt";
import { CHANNEL } from "../version";
import { StationAddressList } from "./StationAddressList";
import { stationAddresses } from "./stationAddresses";

/**
 * Station-link FAB: shows the host's peer ID + a QR code so a station
 * screen can be pointed at this main screen. Sits above the FlightsFab
 * at bottom: 204px and opens a modal with the link details.
 */
export function StationLinkFab() {
  const { open } = useModal();

  function handleClick() {
    open(<StationLinkPanel />, { title: "Add Station" });
  }

  return (
    <Tooltip text="Add station">
      <Fab bottom={204} onClick={handleClick} aria-label="Add station">
        <BroadcastIcon />
      </Fab>
    </Tooltip>
  );
}

function StationLinkPanel() {
  // The modal portal renders outside the PeerHostProvider subtree, so the
  // usePeerHost() context hook would always return null in here. Subscribe
  // to the service singleton directly: it already drives the provider's
  // state, so this sees the same value without relying on React context.
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);
  // The operator-facing short share code. Stable across refreshes; only a
  // regenerate changes it. Both the QR and the typed value are this code,
  // the station derives the broker peer id (`gonogo-host-<code>`) from it.
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

  // While reclaiming the broker hasn't confirmed the derived id (peerId is
  // null), but the share code IS valid, show it with a clear status so the
  // operator can already share the link; stations retry until the host's back.
  if (!peerId && !reclaiming) {
    return (
      <Wrap>
        <StationApprovalPrompt host={peerHostService} inPanel />
        <Empty>Connecting to peer network...</Empty>
      </Wrap>
    );
  }

  const { addresses, qr } = stationAddresses({
    code: shareCode,
    origin: globalThis.location.origin,
    baseUrl: import.meta.env.BASE_URL,
    channel: CHANNEL,
    override: import.meta.env.VITE_STATION_URL,
  });

  return (
    <Wrap>
      {/* The banner strip sits under the modal overlay, so a request is answered here while the panel is open. */}
      <StationApprovalPrompt host={peerHostService} inPanel />
      {reclaiming && (
        <StatusIndicator tone="info" live>
          Reclaiming your share code after an unexpected restart, stations
          reconnect automatically.
        </StatusIndicator>
      )}
      <Cluster>
        <Label>Share code</Label>
        <Code>{shareCode}</Code>
      </Cluster>
      <StationAddressList addresses={addresses} qr={qr} />
      <EndpointState />
      <StationPaths />
      <Hint>
        Scan to open <code>/station</code> on another device, it&apos;ll
        auto-connect to this host. Or copy the link above.
      </Hint>
      <RegenerateRow />
    </Wrap>
  );
}

/**
 * Two-step button: idle → "New share code" → "Confirm" → mints a fresh
 * operator-facing share code and re-claims the new derived
 * `gonogo-host-<newCode>` peer id (clean teardown of the old, claim of the
 * new). The old code stops working and every live station channel drops, so
 * stations must be re-shared the new code. Also the recovery path when a
 * host can't reclaim a stuck broker slot.
 */
function RegenerateRow() {
  const [phase, setPhase] = useState<"idle" | "confirming" | "running">("idle");

  useEffect(() => {
    if (phase !== "confirming") return;
    const reset = setTimeout(() => setPhase("idle"), 4000);
    return () => clearTimeout(reset);
  }, [phase]);

  async function run() {
    setPhase("running");
    try {
      await peerHostService.regenerateShareCode();
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
          New share code
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
        Mints a fresh share code. The old code stops working, anyone who had it
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
 * What stops stations on other networks joining: the relay not running, or
 * its port not opened on the router. Shows nothing once the relay has had the
 * router open it. A port forwarded by hand cannot be seen from here, so that
 * case reads the same as no forward. Read again every 30 s while the window is
 * open.
 */
function EndpointState() {
  const [status, setStatus] = useState<EndpointStatus | null>(
    peerHostService.endpoint.status,
  );
  const opened = usePortOpened();
  useEffect(
    () =>
      peerHostService.endpoint.onAvailable(() =>
        setStatus(peerHostService.endpoint.status),
      ),
    [],
  );

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

const Code = styled.code`
  color: var(--color-info-text);
  /* Display tier: the type scale stops at --font-size-lg on purpose,
     everything above 16px in this codebase is a clamp, a JS fit, or locked
     to a box width. */
  font-size: 18px;
  letter-spacing: 0.12em;
`;

const Hint = styled.p`
  margin: 0;
  font-size: var(--font-size-prose);
  color: var(--color-text-muted);
  line-height: var(--line-height-prose);

  code {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-subtle);
    padding: var(--inset-chip);
    border-radius: var(--radius-regular);
    color: var(--color-text-primary);
  }
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
