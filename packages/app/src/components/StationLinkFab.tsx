import {
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
import {
  CONNECTION_PATH_LABEL,
  type ConnectionPath,
} from "../peer/connectionPath";
import { peerHostService } from "../peer/PeerHostService";
import { probeTurn, type TurnProbeResult } from "../peer/probeTurn";
import { VERSION } from "../version";
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
    return <Empty>Connecting to peer network...</Empty>;
  }

  const { addresses, qr } = stationAddresses({
    code: shareCode,
    origin: globalThis.location.origin,
    baseUrl: import.meta.env.BASE_URL,
    appVersion: VERSION,
    override: import.meta.env.VITE_STATION_URL,
  });

  return (
    <Wrap>
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
      {addresses.map((address) => (
        <UrlRow key={address.id}>
          <Label>{address.label}</Label>
          <UrlValue href={address.url} target="_blank" rel="noreferrer">
            {address.url}
          </UrlValue>
          <UrlWhen>{address.when}</UrlWhen>
        </UrlRow>
      ))}
      <QrRow>
        <QRCodeSVG
          value={qr.url}
          size={160}
          title={`QR code for ${qr.label}`}
        />
      </QrRow>
      {addresses.length > 1 && <UrlWhen>The QR code opens {qr.label}</UrlWhen>}
      <TurnStatus />
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
        <li key={row.peerId}>
          {row.name ?? row.peerId}: {pathText(row.path)}
        </li>
      ))}
    </PathList>
  );
}

function pathText(path: ConnectionPath | null): string {
  return path ? CONNECTION_PATH_LABEL[path] : "path unknown";
}

/**
 * Relay probe badge. Probes the relay's iceServers for a `relay`
 * candidate; surfaces ✅ / 🟡 / ❌ so the operator can tell *before*
 * trying to share the link with a friend whether their relay is
 * actually reachable from outside their network.
 *
 * Re-runs every 30 s while the modal is open; picks up router or
 * relay restarts without spam, and gives the user a fresh check after
 * they fix a port-forward without having to close + reopen the modal.
 */
function TurnStatus() {
  const [state, setState] = useState<
    | { kind: "probing" }
    | { kind: "ok"; result: Extract<TurnProbeResult, { ok: true }> }
    | { kind: "fail"; result: Extract<TurnProbeResult, { ok: false }> }
  >({ kind: "probing" });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState({ kind: "probing" });
      const result = await probeTurn({
        iceServers: peerHostService.iceServers,
      });
      if (cancelled) return;
      setState(result.ok ? { kind: "ok", result } : { kind: "fail", result });
    };
    void run();
    const interval = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const tone =
    state.kind === "ok" ? "go" : state.kind === "fail" ? "nogo" : "info";
  return (
    <StatusIndicator tone={tone} live>
      {state.kind === "probing" && "Checking relay..."}
      {state.kind === "ok" &&
        `Relay answers on this network (${state.result.relayCandidates} relay candidate${
          state.result.relayCandidates === 1 ? "" : "s"
        })`}
      {state.kind === "fail" && describeProbeFailure(state.result)}
    </StatusIndicator>
  );
}

function describeProbeFailure(
  r: Extract<TurnProbeResult, { ok: false }>,
): string {
  if (r.reason === "no-ice-servers") {
    return "No relay configured. Stations connect directly or not at all.";
  }
  if (r.reason === "errored") {
    return "TURN probe errored: see logs (peer:turn-probe).";
  }
  // timeout: most likely cause is router port-forward missing.
  if (r.errors.length > 0) {
    const first = r.errors[0];
    return `TURN unreachable (${first.url} → ${first.code}). Check router port-forward for 3478 (TCP and UDP) and UDP 49160-49170.`;
  }
  return "TURN unreachable: relay never returned a relay candidate. Check router port-forward for 3478 (TCP and UDP) and UDP 49160-49170.";
}

const PathList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 260px;
  color: var(--color-text-primary);
`;

const UrlRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const UrlValue = styled.a`
  color: var(--color-info-text);
  font-size: var(--font-size-value);
  word-break: break-all;
  text-decoration: underline;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const UrlWhen = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
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

const QrRow = styled.div`
  display: flex;
  justify-content: center;
  padding: var(--inset-qr);
  background: var(--color-text-primary);
  border-radius: var(--radius-regular);
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
