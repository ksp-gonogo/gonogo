import { value as quantity } from "@ksp-gonogo/sitrep-sdk";
import { Button, writeQuantity } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { BannerRow } from "./BannerRow";

export interface SourceOfflineEntry {
  id: string;
  name: string;
  /** Free-form status string (e.g. "disconnected", "error"). */
  status: string;
  /** Milliseconds since this source first transitioned to a non-OK status. */
  elapsedMs: number;
  /** When given, the entry shows a "Retry now" button that calls it. */
  onRetry?: () => void;
}

export interface SourceOfflineBannerProps {
  entries: SourceOfflineEntry[];
}

/** Banner inside BannerStack listing sources offline long enough to surface; renders nothing when `entries` is empty. */
export function SourceOfflineBanner({ entries }: SourceOfflineBannerProps) {
  if (entries.length === 0) return null;

  const retries = entries.filter((e) => e.onRetry);

  return (
    <Wrap role="status" aria-live="polite">
      <Pulse />
      <BannerRow
        actions={
          retries.length > 0
            ? retries.map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  onClick={e.onRetry}
                  aria-label={`Retry ${e.name} now`}
                >
                  Retry now
                </Button>
              ))
            : undefined
        }
      >
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
      </BannerRow>
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
  background: color-mix(in srgb, var(--color-alarm-offline) 92%, transparent);
  border: var(--border-width-hairline) solid var(--color-nogo-mark);
  border-radius: var(--radius-banner);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  letter-spacing: calc(0.08em * var(--tracking-scale));
  max-width: 100%;
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
  background: var(--color-nogo-mark);
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
  font-weight: var(--font-weight-bold);
  letter-spacing: calc(0.14em * var(--tracking-scale));
`;

const List = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const Entry = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: baseline;
`;

const EntryName = styled.span`
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
`;

const EntryStatus = styled.span`
  color: var(--color-nogo-text);
  text-transform: uppercase;
  font-size: var(--font-size-caption);
`;

const EntryTime = styled.span`
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
`;
