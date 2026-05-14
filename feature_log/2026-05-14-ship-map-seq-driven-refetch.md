# Ship Map — seq-driven `v.topology` refetch

**Date:** 2026-05-14
**Task:** Performance follow-up surfaced during the live curl validation of `2026-05-14-ship-map-on-telemachus-topology.md`. The widget was subscribing to `v.topology` directly, which keeps the full structural payload streaming at the WS rate even between invalidations.
**Validation:** ⏳ pending — needs a live session to confirm the widget continues to render correctly while bytes-on-the-wire drop.

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
