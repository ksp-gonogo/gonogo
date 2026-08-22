import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { RealAntennasHopRate } from "../__generated__/contract";
import { computeRealAntennasHopRates } from "./hopRates";

// The pure core of the `comm-signal.hop-rates` contribution: it turns hydrated
// `realantennas.hopRates` wire entries into slot entries the CommSignal route
// schedule joins by node id. `bitsPerSec` arrives as a hydrated `Value<"bit/s">`;
// the entry carries its plain magnitude.

function hop(
  fromNodeId: string,
  toNodeId: string,
  bits: number,
): RealAntennasHopRate {
  return {
    fromNodeId,
    toNodeId,
    bitsPerSec: value("bit/s", bits),
  } as RealAntennasHopRate;
}

describe("computeRealAntennasHopRates", () => {
  it("relays each hop's node ids verbatim and unwraps the rate magnitude", () => {
    const entries = computeRealAntennasHopRates([
      hop("Odyssey II", "Relay Sat 1", 262000),
      hop("Relay Sat 1", "home", 48000),
    ]);

    expect(entries).toEqual([
      { fromNodeId: "Odyssey II", toNodeId: "Relay Sat 1", bitsPerSec: 262000 },
      { fromNodeId: "Relay Sat 1", toNodeId: "home", bitsPerSec: 48000 },
    ]);
  });

  it("yields nothing for absent wire (bare CommNet / no RA)", () => {
    expect(computeRealAntennasHopRates(undefined)).toEqual([]);
  });

  it("drops a hop whose rate is non-finite rather than emitting a bad entry", () => {
    const entries = computeRealAntennasHopRates([
      hop("a", "b", Number.NaN),
      hop("b", "home", 9600),
    ]);

    expect(entries).toEqual([
      { fromNodeId: "b", toNodeId: "home", bitsPerSec: 9600 },
    ]);
  });
});
