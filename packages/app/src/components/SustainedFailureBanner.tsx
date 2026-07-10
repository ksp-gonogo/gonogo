import { useDataSources } from "@ksp-gonogo/core";
import { SourceOfflineBanner } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Surfaces data sources that have been disconnected or erroring for longer
 * than the sustained-failure threshold. Hidden while everything's healthy or
 * while a transient blip clears within `THRESHOLD_MS`. Motivated by silent
 * indefinite reconnect loops — without this banner they happen with no UI.
 *
 * Click-through is intentionally deferred — the visible banner is the
 * affordance; opening a panel from here would compete with the existing
 * Data Source Status widget which surfaces the same info in detail.
 */

const THRESHOLD_MS = 15_000;
const TICK_MS = 1_000;

export function SustainedFailureBanner() {
  const all = useDataSources();

  // Track the timestamp each source first went non-OK. Cleared when it
  // recovers. Survives re-renders via a ref so transient useDataSources
  // re-fires don't restart the clock.
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

  const entries = all
    .filter((s) => sinceRef.current.has(s.id))
    .filter((s) => now - (sinceRef.current.get(s.id) ?? now) >= THRESHOLD_MS)
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      elapsedMs: now - (sinceRef.current.get(s.id) ?? now),
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

  return <SourceOfflineBanner entries={entries} />;
}
