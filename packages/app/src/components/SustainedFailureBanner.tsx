import {
  type DataSourceStatus,
  useDataSources,
  useStreamSources,
} from "@gonogo/core";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Surfaces data sources / stream sources that have been disconnected or
 * erroring for longer than the sustained-failure threshold. Hidden while
 * everything's healthy or while a transient blip clears within
 * `THRESHOLD_MS`. The OCISLY relay reconnect loop motivates the UI: prior
 * to this banner, an indefinite retry would happen entirely silently.
 *
 * Click-through is intentionally deferred — the visible banner is the
 * affordance; opening a panel from here would compete with the existing
 * Data Source Status widget which surfaces the same info in detail.
 */

const THRESHOLD_MS = 15_000;
const TICK_MS = 1_000;

interface Failing {
  id: string;
  name: string;
  status: DataSourceStatus;
  /** Wall-clock ms when this source first transitioned to a non-OK status. */
  since: number;
}

export function SustainedFailureBanner() {
  const dataSources = useDataSources();
  const streamSources = useStreamSources();

  // Combine both source kinds into a single working list keyed by id. Stream
  // sources reuse DataSourceStatus values so the OK predicate is shared.
  const all = [...dataSources, ...streamSources];

  // Track the timestamp each source first went non-OK. Cleared when it
  // recovers. Survives re-renders via a ref so transient
  // useDataSources/useStreamSources re-fires don't restart the clock.
  const sinceRef = useRef<Map<string, number>>(new Map());
  const [, tick] = useState(0);

  // Update the since-map whenever statuses change. Done in render rather
  // than an effect so the first failing render already has the timestamp;
  // an effect-based update would let one render cycle slip past unmarked.
  const now = Date.now();
  for (const s of all) {
    const ok = s.status === "connected" || s.status === "reconnecting";
    if (ok) {
      sinceRef.current.delete(s.id);
    } else if (!sinceRef.current.has(s.id)) {
      sinceRef.current.set(s.id, now);
    }
  }
  // Garbage-collect ids that have been deregistered entirely.
  const liveIds = new Set(all.map((s) => s.id));
  for (const id of [...sinceRef.current.keys()]) {
    if (!liveIds.has(id)) sinceRef.current.delete(id);
  }

  const failing: Failing[] = all
    .filter((s) => sinceRef.current.has(s.id))
    .filter((s) => now - (sinceRef.current.get(s.id) ?? now) >= THRESHOLD_MS)
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      since: sinceRef.current.get(s.id) ?? now,
    }));

  // Re-render once per second so a source that crosses THRESHOLD_MS
  // shows up even when nothing else is re-rendering us, and so the
  // elapsed-time labels stay current. Always on while mounted: a 1Hz
  // tick that early-returns null on a healthy state is functionally
  // free, and gating the interval on a derived "has-failures"
  // proxy was both fragile (timing against fake timers) and not
  // worth the saved cycles.
  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
    }, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  if (failing.length === 0) return null;

  return (
    <Wrap role="status" aria-live="polite">
      <Pulse />
      <Label>SOURCE OFFLINE</Label>
      <List>
        {failing.map((f) => (
          <Entry key={f.id}>
            <EntryName>{f.name}</EntryName>
            <EntryStatus>{f.status}</EntryStatus>
            <EntryTime>{formatElapsed(now - f.since)}</EntryTime>
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

// ── Styles ──────────────────────────────────────────────────────────────────

const Wrap = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: rgba(120, 30, 30, 0.9);
  border-bottom: 1px solid var(--color-status-nogo-bg);
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
