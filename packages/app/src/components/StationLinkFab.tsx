import {
  BroadcastIcon,
  Fab,
  GhostButton,
  StatusIndicator,
  useModal,
} from "@ksp-gonogo/ui";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { peerHostService } from "../peer/PeerHostService";
import { probeTurn, type TurnProbeResult } from "../peer/probeTurn";

/**
 * Station-link FAB — shows the host's peer ID + a QR code so a station
 * screen can be pointed at this main screen. Sits above the FlightsFab
 * at bottom: 144px and opens a modal with the link details.
 */
export function StationLinkFab() {
  const { open } = useModal();

  function handleClick() {
    open(<StationLinkPanel />, { title: "Add Station" });
  }

  return (
    <Fab
      bottom={144}
      onClick={handleClick}
      aria-label="Add station"
      title="Add station"
    >
      <BroadcastIcon />
    </Fab>
  );
}

/**
 * Canonical deployed station URL — used when the host is running on a
 * local-dev origin (localhost / LAN IP) so the QR a phone scans points
 * at the HTTPS GitHub Pages build instead of an unreachable
 * `http://192.168.x.x:5173`. Forks can override via VITE_STATION_URL.
 */
const PROJECT_STATION_URL = "https://ksp-gonogo.github.io/gonogo/station";

function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|\d+\.\d+\.\d+\.\d+)(?::\d+)?$/.test(
    origin,
  );
}

/**
 * Build the absolute station URL for this host.
 *
 * Priority:
 *  1. `VITE_STATION_URL` if set — explicit override for forks pointing at
 *     their own deploy.
 *  2. Page origin — when the host page itself is loaded from an HTTPS
 *     deploy, that's the right base for stations too.
 *  3. `PROJECT_STATION_URL` — fallback when the host is on a local-dev
 *     origin (localhost / LAN IP). Stations on phones / friends'
 *     machines can't reach those, so the QR points at the canonical
 *     deploy instead.
 *
 * The share code rides as `?host=` so the station screen can auto-connect
 * on landing without the user typing anything. The station derives the
 * host's broker peer id (`gonogo-host-<code>`) from it and connects directly.
 */
function buildStationUrl(code: string): string {
  const override = import.meta.env.VITE_STATION_URL;
  if (override) {
    return `${override.replace(/\/$/, "")}?host=${encodeURIComponent(code)}`;
  }
  const origin = globalThis.location.origin;
  if (isLocalDevOrigin(origin)) {
    return `${PROJECT_STATION_URL}?host=${encodeURIComponent(code)}`;
  }
  const base = import.meta.env.BASE_URL;
  return `${origin}${base}station?host=${encodeURIComponent(code)}`;
}

function StationLinkPanel() {
  // The modal portal renders outside the PeerHostProvider subtree, so the
  // usePeerHost() context hook would always return null in here. Subscribe
  // to the service singleton directly — it already drives the provider's
  // state, so this sees the same value without relying on React context.
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);
  // The operator-facing 4-char share code. Stable across refreshes; only a
  // regenerate changes it. Both the QR and the typed value are this code —
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
  // null), but the share code IS valid — show it with a clear status so the
  // operator can already share the link; stations retry until the host's back.
  if (!peerId && !reclaiming) {
    return <Empty>Connecting to peer network…</Empty>;
  }

  const url = buildStationUrl(shareCode);

  return (
    <Wrap>
      {reclaiming && (
        <StatusIndicator tone="info" live>
          Reclaiming your share code after an unexpected restart — stations
          reconnect automatically.
        </StatusIndicator>
      )}
      <Row>
        <Label>Share code</Label>
        <Code>{shareCode}</Code>
      </Row>
      <UrlRow>
        <Label>Link</Label>
        <UrlValue href={url} target="_blank" rel="noreferrer">
          {url}
        </UrlValue>
      </UrlRow>
      <QrRow>
        <QRCodeSVG value={url} size={160} />
      </QrRow>
      <TurnStatus />
      <Hint>
        Scan to open <code>/station</code> on another device — it&apos;ll
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
        <GhostButton type="button" onClick={() => setPhase("confirming")}>
          New share code
        </GhostButton>
      )}
      {phase === "confirming" && (
        <GhostButton type="button" onClick={run}>
          Confirm — old code stops working
        </GhostButton>
      )}
      {phase === "running" && (
        <GhostButton type="button" disabled>
          Generating…
        </GhostButton>
      )}
      <RegenerateHint>
        Mints a fresh share code. The old code stops working — anyone who had it
        (including connected stations once they drop) needs the new code shown
        above.
      </RegenerateHint>
    </RegenerateWrap>
  );
}

/**
 * TURN reachability badge. Probes the relay's iceServers for a `relay`
 * candidate; surfaces ✅ / 🟡 / ❌ so the operator can tell *before*
 * trying to share the link with a friend whether their relay is
 * actually reachable from outside their network.
 *
 * Re-runs every 30 s while the modal is open — picks up router or
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
      {state.kind === "probing" && "Checking TURN reachability…"}
      {state.kind === "ok" &&
        `TURN reachable (${state.result.relayCandidates} relay candidate${
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
    return "No TURN configured — off-network stations won't be able to connect.";
  }
  if (r.reason === "errored") {
    return "TURN probe errored — see logs (peer:turn-probe).";
  }
  // timeout — most likely cause is router port-forward missing.
  if (r.errors.length > 0) {
    const first = r.errors[0];
    return `TURN unreachable (${first.url} → ${first.code}). Check router port-forward for UDP 3478 + 49160-49200.`;
  }
  return "TURN unreachable — relay never returned a relay candidate. Check router port-forward for UDP 3478 + 49160-49200.";
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 260px;
  color: var(--color-text-primary);
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const UrlRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const UrlValue = styled.a`
  color: var(--color-status-info-fg);
  font-size: 12px;
  word-break: break-all;
  text-decoration: underline;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const Code = styled.code`
  color: var(--color-status-info-fg);
  font-size: 18px;
  letter-spacing: 0.12em;
`;

const QrRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
  background: var(--color-text-primary);
  border-radius: 4px;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.5;

  code {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-subtle);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--color-text-primary);
  }
`;

const Empty = styled.div`
  padding: 16px 0;
  font-size: 12px;
  color: var(--color-text-dim);
  text-align: center;
`;

const RegenerateWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 12px;
`;

const RegenerateHint = styled.p`
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.5;
`;
