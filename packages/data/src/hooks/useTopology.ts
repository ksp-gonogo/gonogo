import { getDataSource, useDataValue, type VesselTopology } from "@gonogo/core";
import { useEffect, useState } from "react";

/**
 * Wait this long for `v.topology` to push back after a `v.topologySeq` bump
 * before giving up on this fetch attempt. The next seq tick will re-arm
 * the effect anyway, so a missed window self-heals.
 *
 * Telemachus's default rate is 250ms, so 2s is ~8 ticks of headroom.
 */
const FETCH_TIMEOUT_MS = 2_000;

/**
 * Read `v.topology` from Telemachus using the seq-driven refetch pattern:
 *
 * 1. Continuously subscribe to `v.topologySeq` (lightweight int).
 * 2. When the seq value changes, briefly subscribe to `v.topology`, take
 *    the first pushed payload, then unsubscribe.
 * 3. Return the most recent topology between bumps. Nothing streams over
 *    the wire for the structural payload during stable flight — only the
 *    seq int does.
 *
 * Why this rather than `useDataValue('data', 'v.topology')`: a direct
 * subscription pulls the full topology payload at the WS rate (~4Hz)
 * regardless of whether it actually changed. For a 100-part vessel that's
 * ~7KB × 4Hz = ~28KB/s of redundant traffic. The seq-driven pattern keeps
 * the steady-state cost flat at a few bytes per tick.
 *
 * Works through `PeerBroadcastingDataSource` (station screens) without
 * modification — both subscribe calls forward through the peer channel.
 */
export function useTopology(dataSourceId = "data"): VesselTopology | undefined {
  const seq = useDataValue(dataSourceId, "v.topologySeq");
  const [topology, setTopology] = useState<VesselTopology | undefined>(
    undefined,
  );

  useEffect(() => {
    if (seq === undefined) return;
    const source = getDataSource(dataSourceId);
    if (!source) return;

    let cancelled = false;
    let unsub: (() => void) | undefined;
    const timer = setTimeout(() => {
      // Subscribe never pushed — release the slot. Next seq bump will
      // re-arm; if no bump comes, the topology stays at the last value.
      unsub?.();
      unsub = undefined;
    }, FETCH_TIMEOUT_MS);

    unsub = source.subscribe("v.topology", (value) => {
      if (cancelled) return;
      if (!value || typeof value !== "object") return;
      // Sanity-check the shape so we don't store a paused-handler sentinel
      // (a number) or a non-topology object.
      const candidate = value as Partial<VesselTopology>;
      if (!Array.isArray(candidate.parts)) return;

      clearTimeout(timer);
      setTopology(value as VesselTopology);
      // Drop the subscription as soon as we've taken a snapshot — the
      // seq subscription will tell us when to ask again.
      unsub?.();
      unsub = undefined;
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsub?.();
    };
  }, [seq, dataSourceId]);

  return topology;
}
