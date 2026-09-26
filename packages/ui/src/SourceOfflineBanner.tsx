import { value as quantity } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
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

/** Banner inside BannerStack listing sources offline long enough to surface; renders nothing when `entries` is empty. */
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

// Real time, not game time: this is how long a source has been offline on the desk clock.
function formatElapsed(ms: number): string {
  return writeQuantity(quantity("irl:s", ms / 1000));
}

const Wrap = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-section);
  padding: var(--inset-alert-band);
  background: rgba(120, 30, 30, 0.92);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: var(--radius-pill);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-compact);
  letter-spacing: 0.08em;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: bannerSlideIn var(--duration-entrance) var(--ease-entrance) forwards;
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
  border-radius: var(--radius-circle);
  background: var(--color-status-nogo-bg);
  flex-shrink: 0;
  /* Known fault: this animation sits outside the reduced-motion guard that holds its keyframes. */
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
  gap: var(--gap-related);
  flex-wrap: nowrap;
`;

const Entry = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: baseline;
`;

const EntryName = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
`;

const EntryStatus = styled.span`
  color: var(--color-status-nogo-fg);
  text-transform: uppercase;
  font-size: var(--font-size-caption);
`;

const EntryTime = styled.span`
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
`;
