import {
  getDataSource,
  useDataValue,
  type VesselTopology,
} from "@ksp-gonogo/core";
import { useEffect, useState } from "react";

/**
 * Read `v.topology` from Telemachus using the seq-driven refetch pattern:
 *
 * 1. Continuously subscribe to `v.topologySeq` (lightweight int).
 * 2. When the seq value changes, subscribe to `v.topology`, take the
 *    first pushed payload, then unsubscribe.
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
 *
 * The fetch subscription is held until either the push arrives or the
 * next seq bump triggers cleanup. An earlier version had a 2s safety
 * timeout that dropped the subscription on its own; during a destruction
 * cascade Telemachus could be busy long enough for the timeout to fire,
 * and if seq then stabilised before a push arrived the hook would never
 * re-arm and the widget froze at the pre-cascade snapshot. With no timer
 * the subscription self-heals — once Telemachus catches up, its next push
 * lands on our still-live subscription and we drop the sub on the spot.
 * Per-bump bandwidth stays bounded because the handler unsubscribes on
 * the first valid push.
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

    unsub = source.subscribe("v.topology", (value) => {
      if (cancelled) return;
      if (!value || typeof value !== "object") return;
      // Sanity-check the shape so we don't store a paused-handler sentinel
      // (a number) or a non-topology object.
      const candidate = value as Partial<VesselTopology>;
      if (!Array.isArray(candidate.parts)) return;

      setTopology(value as VesselTopology);
      // Drop the subscription as soon as we've taken a snapshot — the
      // seq subscription will tell us when to ask again.
      unsub?.();
      unsub = undefined;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [seq, dataSourceId]);

  return topology;
}
