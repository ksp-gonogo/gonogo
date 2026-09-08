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

/**
 * Inline banner listing data / stream sources that have been disconnected
 * or erroring long enough to surface. Designed to be placed inside the
 * shared `<BannerStack />` in the bottom-right corner, no fixed
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

// The kit's wall-clock ladder, not a fifth copy of the same s/m/h staircase.
// `irl:s` rather than `s`: this is how long a source has been offline, timed
// by the clock on the desk, and the game-time ladder would call four real
// hours a Kerbin day.
function formatElapsed(ms: number): string {
  return writeQuantity(quantity("irl:s", ms / 1000));
}

const Wrap = styled.div`
  display: flex;
  align-items: center;
  /* Both levels of the ladder, so the grouping reads without counting pixels:
     the OFFLINE label and the source list are different kinds of thing
     (section), and everything below that is siblings of one kind (related).
     A source's name and its status used to take a third, tighter level; the
     vocabulary no longer has one, and the entries carry their own baseline
     alignment, so they read as entries without it. */
  gap: var(--gap-section);
  /* The chrome band, in rungs. 16 is the cross-package gutter lock the ladder
     documents, and this pill floats over the whole app rather than sitting in
     a widget, so --inset-surface's 8 would set it in tighter than anything it
     overlaps. No --inset-* names this pair on purpose: the token that once did
     described banners, buttons, cards and touch targets alike. */
  padding: var(--space-10) var(--space-16);
  background: rgba(120, 30, 30, 0.92);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: var(--radius-pill);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-sm);
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
  /* Left entirely literal, and not because 1.4s is off the duration scale
     (it is: this is an attention pulse, not a UI transition). The shorthand
     sits OUTSIDE the prefers-reduced-motion guard below while its keyframes
     sit inside it, which is a pre-existing accessibility bug. Rewriting half
     of this declaration onto tokens would make the broken shape read as
     blessed. Fix the guard first, then tokenise the easing. Readout's
     pill-pulse and BannerPill's status-pill-pulse show the correct shape. */
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
  font-size: var(--font-size-xs);
`;

const EntryTime = styled.span`
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
`;
