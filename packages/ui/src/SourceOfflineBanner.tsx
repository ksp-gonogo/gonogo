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
 * Inline banner listing data / stream sources that have been disconnected
 * or erroring long enough to surface. Designed to be placed inside the
 * shared `<BannerStack />` in the bottom-right corner — no fixed
 * positioning of its own. Renders nothing when `entries` is empty.
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
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(120, 30, 30, 0.92);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: 999px;
  color: var(--color-status-nogo-fg);
  font-size: 12px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: bannerSlideIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: right center;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes bannerSlideIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
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
  flex-wrap: nowrap;
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
