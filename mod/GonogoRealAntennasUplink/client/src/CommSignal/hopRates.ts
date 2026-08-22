import type { ContributionEntry } from "@ksp-gonogo/sitrep-sdk";
import type { RealAntennasHopRate } from "../__generated__/contract";
import { REALANTENNAS_HOP_RATES_TOPIC } from "../topics";
import { REALANTENNAS } from "../uplink";

// ---------------------------------------------------------------------------
// The RealAntennas half of the `comm-signal.hop-rates` contribution: per-hop
// forward band rates for the base CommSignal route schedule, read off this
// Uplink's own `realantennas.hopRates` Topic and yielded keyed by the SAME node
// ids `comms.path` carries. CommSignal joins each rate onto the hop it already
// renders (and flags the bottleneck) without ever importing backend-aware code
// or naming RealAntennas: it only knows the slot id.
//
// This is the `ship-map.part-meters` pattern (a contribution whose `compute`
// reads a live Topic and yields data), the reader for a channel that reached the
// SDK end to end and then had nowhere to render. `requires: "realantennas"`
// gates it on the Domain presence channel, so bare CommNet yields no
// contribution and the schedule shows no bitrate, unchanged.
//
// The entry relays the raw node ids rather than a pre-joined key: the single
// hop-id derivation lives in CommSignal's own `commsRoute.ts`, where the join
// happens, so there is exactly one place that decides how a hop is identified.
// ---------------------------------------------------------------------------

type HopRateEntry = ContributionEntry<"comm-signal.hop-rates">;

/**
 * Pure core of the contribution, exported so a test can call it directly against
 * a plain `RealAntennasHopRate[]` fixture without going through the contribution
 * registry (mirrors the ShipMap contributions' export-the-pure-core pattern).
 * `bitsPerSec` arrives hydrated as `Value<"bit/s">`; the entry carries its plain
 * magnitude so the schedule can compare rates for the bottleneck and wrap the
 * number in `<Unit>` itself.
 */
export function computeRealAntennasHopRates(
  wire: readonly RealAntennasHopRate[] | undefined,
): HopRateEntry[] {
  if (!wire) return [];
  const entries: HopRateEntry[] = [];
  for (const hop of wire) {
    const bits = hop.bitsPerSec?.magnitude;
    if (bits === undefined || !Number.isFinite(bits)) continue;
    entries.push({
      fromNodeId: hop.fromNodeId,
      toNodeId: hop.toNodeId,
      bitsPerSec: bits,
    });
  }
  return entries;
}

REALANTENNAS.registerContribution({
  id: "comm-signal-hop-rates",
  contributes: "comm-signal.hop-rates",
  requires: "realantennas",
  deps: [REALANTENNAS_HOP_RATES_TOPIC],
  compute: (topics) =>
    computeRealAntennasHopRates(
      topics[REALANTENNAS_HOP_RATES_TOPIC] as
        | readonly RealAntennasHopRate[]
        | undefined,
    ),
});
