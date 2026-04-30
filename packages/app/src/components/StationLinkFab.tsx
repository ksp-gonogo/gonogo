import { BroadcastIcon, Fab, useModal } from "@gonogo/ui";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { peerHostService } from "../peer/PeerHostService";

/**
 * Station-link FAB — shows the host's peer ID + a QR code so a station
 * screen can be pointed at this main screen. Sits above the FlightsFab
 * at bottom: 204px and opens a modal with the link details.
 */
export function StationLinkFab() {
  const { open } = useModal();

  function handleClick() {
    open(<StationLinkPanel />, { title: "Add Station" });
  }

  return (
    <Fab
      bottom={204}
      onClick={handleClick}
      aria-label="Add station"
      title="Add station"
    >
      <BroadcastIcon />
    </Fab>
  );
}

/**
 * Build the absolute station URL for this host. `BASE_URL` is "/" in dev
 * and "/gonogo/" on GitHub Pages — using it (vs. hardcoding "/station")
 * keeps the QR working on both. The host id rides as `?host=` so the
 * station screen can auto-connect on landing without the user typing
 * anything.
 */
function buildStationUrl(peerId: string): string {
  const base = import.meta.env.BASE_URL;
  return `${globalThis.location.origin}${base}station?host=${encodeURIComponent(peerId)}`;
}

function StationLinkPanel() {
  // The modal portal renders outside the PeerHostProvider subtree, so the
  // usePeerHost() context hook would always return null in here. Subscribe
  // to the service singleton directly — it already drives the provider's
  // state, so this sees the same value without relying on React context.
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);
  useEffect(() => {
    const unsub = peerHostService.onPeerIdChange(setPeerId);
    return () => {
      unsub();
    };
  }, []);

  if (!peerId) {
    return <Empty>Connecting to peer network…</Empty>;
  }

  const url = buildStationUrl(peerId);

  return (
    <Wrap>
      <Row>
        <Label>Host ID</Label>
        <Code>{peerId}</Code>
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
      <Hint>
        Scan to open <code>/station</code> on another device — it&apos;ll
        auto-connect to this host. Or copy the link above.
      </Hint>
    </Wrap>
  );
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
