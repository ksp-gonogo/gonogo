# Ship Map — seq-driven `v.topology` refetch

**Date:** 2026-05-14
**Task:** Performance follow-up surfaced during the live curl validation of `2026-05-14-ship-map-on-telemachus-topology.md`. The widget was subscribing to `v.topology` directly, which keeps the full structural payload streaming at the WS rate even between invalidations.
**Validation:** ⏳ pending — Stress-tested 2026-05-15 in a twin-rover docking + staging session. Hook tracks correctly through structural-growth events (dock 86→88; second dock 214→216) and clean two-rocket splits (SAS-stabilised 216→218). **One bug found**: hook freezes during rapid destruction cascades — widget caught seq 119 when real seq advanced to 147 via ~30 `onPartDie` bumps over 16s. Hypothesis: `FETCH_TIMEOUT_MS = 2000` expires while Telemachus is busy churning destruction events; the hook drops the subscription and waits for the next seq bump to re-arm; if that next bump also fails to push back within 2s and seq subsequently stabilises, the hook never re-arms. Phase 2 fix candidate documented in `local_docs/2026-05-16-phase-2-shipmap-handoff.md`. DevTools WS-frame inspection skipped — streaming-WS evidence from the 2026-05-15 logs (`/tmp/{dock,stage,pass2}-stream*.log`) proves topology pushes only flow after seq bumps under normal conditions.

## Overview

New `useTopology(dataSourceId?)` hook in `@gonogo/data`. Subscribes continuously to the lightweight `v.topologySeq` int and, on each seq change, briefly re-subscribes to `v.topology`, takes the first valid push, then immediately unsubscribes. The returned `VesselTopology | undefined` updates only when the structure actually changes.

The Ship Map widget swaps `useDataValue("data", "v.topology")` for `useTopology("data")`. No other consumer code changes.

## Why this matters

Telemachus pushes every subscribed key on every tick (~4Hz default) regardless of whether the value changed. With the direct subscription, the structural payload was going down the wire 4× per second even on a stable vessel. The cost scales with vessel size:

| Vessel size | Topology bytes | At 4Hz |
|---|---|---|
| 9 parts (today's test rocket) | ~1.4 KB | 5.6 KB/s |
| 50 parts | ~7 KB | 28 KB/s |
| 200-part station | ~30 KB | 120 KB/s |

With the seq-driven pattern, the steady-state traffic is just the `v.topologySeq` int (~5 bytes per push). The full topology only flows during the brief window after a structural-change bump.

## Files

- `packages/data/src/hooks/useTopology.ts` (new) — the hook
- `packages/data/src/hooks/useTopology.test.tsx` (new) — covers first-load, seq-bump refetch, repeated-same-seq no-op, sentinel filtering, and the unsubscribe-after-first-push invariant
- `packages/data/src/index.ts` — export
- `packages/components/src/ShipMap/index.tsx` — swap `useDataValue("data", "v.topology")` for `useTopology("data")`

## How it works

```ts
const seq = useDataValue(dataSourceId, "v.topologySeq");
const [topology, setTopology] = useState<VesselTopology | undefined>(undefined);

useEffect(() => {
  if (seq === undefined) return;
  const source = getDataSource(dataSourceId);
  if (!source) return;

  let cancelled = false;
  let unsub: (() => void) | undefined;
  const timer = setTimeout(() => { unsub?.(); unsub = undefined; }, FETCH_TIMEOUT_MS);

  unsub = source.subscribe("v.topology", (value) => {
    if (cancelled || !value || typeof value !== "object") return;
    const candidate = value as Partial<VesselTopology>;
    if (!Array.isArray(candidate.parts)) return;
    clearTimeout(timer);
    setTopology(value as VesselTopology);
    unsub?.();
    unsub = undefined;
  });

  return () => { cancelled = true; clearTimeout(timer); unsub?.(); };
}, [seq, dataSourceId]);
```

Notes worth keeping:

- **Sentinel filtering** — Telemachus's `ThermalDataLinkHandler.pausedHandler` (inherited by the topology handler? — no, but a similar pattern could return scalar sentinels in the future) means we have to reject non-object payloads. Without this guard a sentinel of `1` would overwrite the last good topology with garbage.
- **2s timeout** — if `v.topology` never pushes back after a seq bump (e.g. Telemachus dropped or the subscription was rate-limited), release the slot so the next seq bump can re-arm cleanly. Self-heals on the next invalidation.
- **`PeerBroadcastingDataSource` compatible** — both subscribe calls forward through the peer channel without modification. Station screens get the same behavior; whatever traffic optimization the host does, the station inherits.

## Validation

- Unit tests cover the four key invariants (first load, refetch on bump, no-op on same seq, unsubscribe after first push, sentinel rejection).
- Workspace typecheck + lint clean, 1078 tests pass.
- **Pending live check:** render the widget against a flying rocket, observe browser DevTools → WS frames; confirm `v.topology` frames only appear right after a seq bump rather than continuously.

## Follow-up open elsewhere

- `mods.part[flightId]` for deployable state (parachute / solar / antenna / engine ignition) — separate Telemachus fork addition; queued.
