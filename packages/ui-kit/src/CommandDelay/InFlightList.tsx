import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { formatCountdown } from "../formatDuration";

/**
 * Vanilla-safe display shape for one delayed command, a deliberate LOCAL
 * redeclaration, not an import of `@ksp-gonogo/sitrep-client`'s
 * `InFlightCommand`: this package carries no data hooks and no gonogo-type
 * imports (design: "InFlightList"/"CommandGroup" stay props-driven only).
 * `etaSeconds` is the caller's choice of which clock to show (reach vs.
 * reply): `null` renders as "no ETA" (e.g. an already-`overdue`/`lost`
 * entry, or a `no-path` mode with nothing to count toward).
 */
export interface InFlightListItem {
  id: string;
  label: string;
  etaSeconds: number | null;
  phase: "in-transit" | "awaiting-reply" | "due" | "overdue" | "lost";
}

export type InFlightListMode = "live" | "staged" | "no-path";

export interface InFlightListProps {
  items: InFlightListItem[];
  mode?: InFlightListMode;
  /** Accessible label for the list region. Defaults to "In-flight commands". */
  ariaLabel?: string;
}

const PHASE_ARROW: Record<InFlightListItem["phase"], string> = {
  "in-transit": "↑",
  "awaiting-reply": "↓",
  due: "↓",
  overdue: "!",
  lost: "✕",
};

const ERROR_PHASES = new Set<InFlightListItem["phase"]>(["overdue", "lost"]);

/** Re-seed the local countdown only on a jump this large (seconds), the
 * caller's own `etaSeconds` reads (e.g. `useCommand`'s synchronous
 * `nowUt`) drift by fractions of a second on every unrelated re-render;
 * resyncing on every one of those would fight the local tick below and
 * tear its interval down constantly instead of letting it run. */
const RESYNC_THRESHOLD_SECONDS = 1;

/**
 * A pure, local-ticking countdown value: seeds from `etaSeconds`, resyncs
 * only on a real jump (a fresh dispatch, a phase transition), and otherwise
 * decrements once per second on its OWN mount-once interval, so the
 * displayed number stays smooth even when the caller only recomputes
 * `etaSeconds` on a slower (or noisier) cadence. Pure in the sense the
 * design calls for: it operates ONLY on the value passed in, no data
 * source, no clock import.
 */
export function useCountdown(etaSeconds: number | null): number | null {
  const [value, setValue] = useState(etaSeconds);
  const lastSeedRef = useRef(etaSeconds);

  useEffect(() => {
    const last = lastSeedRef.current;
    const jumped =
      (last === null) !== (etaSeconds === null) ||
      (last !== null &&
        etaSeconds !== null &&
        Math.abs(etaSeconds - last) >= RESYNC_THRESHOLD_SECONDS);
    if (jumped) {
      lastSeedRef.current = etaSeconds;
      setValue(etaSeconds);
    }
  }, [etaSeconds]);

  // Mount-once local tick: deliberately NOT keyed on `etaSeconds` (see
  // `RESYNC_THRESHOLD_SECONDS`'s doc): tying this interval's lifetime to a
  // value that drifts on every render would tear it down and recreate it
  // constantly instead of ever letting a full second elapse.
  useEffect(() => {
    const id = setInterval(() => {
      setValue((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return value;
}

/**
 * Presentational set-renderer for `InFlightCommand`-shaped items (0/1/N):
 * a stack of in-flight rows with per-entry countdowns and phase-appropriate
 * styling. Renders nothing for an empty set. No data hooks, a widget feeds
 * it `useCommand().inFlight` or `useRouteCommands(topic).items` directly.
 */
export function InFlightList({
  items,
  mode,
  ariaLabel = "In-flight commands",
}: InFlightListProps) {
  if (items.length === 0) return null;

  return (
    <InFlightList__Root aria-label={ariaLabel} data-mode={mode}>
      {items.map((item) => (
        <InFlightRow key={item.id} item={item} />
      ))}
    </InFlightList__Root>
  );
}

function InFlightRow({ item }: { item: InFlightListItem }) {
  const countdown = useCountdown(item.etaSeconds);
  const isError = ERROR_PHASES.has(item.phase);
  return (
    <InFlightList__Row $phase={item.phase}>
      <InFlightList__Arrow aria-hidden="true" $pulse={!isError}>
        {PHASE_ARROW[item.phase]}
      </InFlightList__Arrow>
      <InFlightList__Label>{item.label}</InFlightList__Label>
      <InFlightList__Phase>
        {countdown === null ? item.phase : formatCountdown(countdown)}
      </InFlightList__Phase>
    </InFlightList__Row>
  );
}

const InFlightList__Root = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 2px);
  padding: var(--space-4, 4px) var(--space-8, 8px);
  font-family: monospace;
  font-size: var(--font-size-xs);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 4px);
  box-sizing: border-box;
`;

const PHASE_ROW_STYLES: Record<
  InFlightListItem["phase"],
  ReturnType<typeof css>
> = {
  "in-transit": css`
    color: var(--color-text-primary);
  `,
  "awaiting-reply": css`
    color: var(--color-text-muted);
  `,
  due: css`
    color: var(--color-text-muted);
  `,
  overdue: css`
    color: var(--color-status-warning-fg);
  `,
  lost: css`
    color: var(--color-status-nogo-fg);
  `,
};

const InFlightList__Row = styled.div<{ $phase: InFlightListItem["phase"] }>`
  display: flex;
  align-items: baseline;
  gap: var(--space-6, 6px);

  ${({ $phase }) => PHASE_ROW_STYLES[$phase]}
`;

const InFlightList__Arrow = styled.span<{ $pulse: boolean }>`
  flex: 0 0 auto;
  color: var(--color-accent-fg);

  ${({ $pulse }) =>
    $pulse &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: in-flight-list-pulse 1.6s var(--ease-emphasis, ease-in-out) infinite;
      }
    `}

  @keyframes in-flight-list-pulse {
    50% {
      opacity: 0.35;
    }
  }
`;

const InFlightList__Label = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const InFlightList__Phase = styled.span`
  flex: 0 0 auto;
  color: inherit;
  opacity: 0.85;
`;
