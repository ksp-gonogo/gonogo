import styled from "styled-components";

export interface SourceOfflineEntry {
  id: string;
  name: string;
  /** Free-form status string (e.g. "disconnected", "error"). */
  status: string;
  /** Milliseconds since this source first transitioned to a non-OK status. */
  elapsedMs: number;
}

export interface SourceOfflineBannerProps {
  entries: SourceOfflineEntry[];
}

/**
 * Pinned banner along the bottom of the viewport listing data / stream
 * sources that have been disconnected or erroring long enough to surface.
 * Renders nothing when `entries` is empty.
 */
export function SourceOfflineBanner({ entries }: SourceOfflineBannerProps) {
  if (entries.length === 0) return null;

  return (
    <Wrap role="status" aria-live="polite">
      <Pulse />
      <Label>SOURCE OFFLINE</Label>
      <List>
        {entries.map((e) => (
          <Entry key={e.id}>
            <EntryName>{e.name}</EntryName>
            <EntryStatus>{e.status}</EntryStatus>
            <EntryTime>{formatElapsed(e.elapsedMs)}</EntryTime>
          </Entry>
        ))}
      </List>
    </Wrap>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

const Wrap = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
  padding-left: calc(14px + env(safe-area-inset-left, 0px));
  padding-right: calc(14px + env(safe-area-inset-right, 0px));
  background: rgba(120, 30, 30, 0.9);
  border-top: 1px solid var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  font-size: 12px;
  letter-spacing: 0.08em;
  flex-wrap: wrap;
`;

const Pulse = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-nogo-bg);
  flex-shrink: 0;
  animation: pulse 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }
  }
`;

const Label = styled.span`
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.14em;
`;

const List = styled.div`
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
`;

const Entry = styled.div`
  display: flex;
  gap: 6px;
  align-items: baseline;
`;

const EntryName = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
`;

const EntryStatus = styled.span`
  color: var(--color-status-nogo-fg);
  text-transform: uppercase;
  font-size: var(--font-size-xs);
`;

const EntryTime = styled.span`
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
`;
