import { deriveCelestialFacts } from "@ksp-gonogo/sitrep-client";
import { type BodyEntry, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { bodyOffsetAt } from "./patchOffsets";

const MUN_SMA = 12_000_000;

const FACTS = deriveCelestialFacts([
  {
    index: 0,
    name: "Kerbin",
    parentIndex: null,
    gravParameter: value("m³/s²", 3.5316e12),
    orbit: null,
  } as BodyEntry,
  {
    index: 1,
    name: "Mun",
    parentIndex: 0,
    gravParameter: value("m³/s²", 6.5138398e10),
    orbit: {
      sma: value("m", MUN_SMA),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
    },
  } as BodyEntry,
]);

describe("bodyOffsetAt", () => {
  it("puts a body at its orbit's radius from the frame body", () => {
    const at = bodyOffsetAt(FACTS, "Kerbin", "Mun", 0, null);
    expect(Math.hypot(at?.x ?? 0, at?.y ?? 0, at?.z ?? 0)).toBeCloseTo(
      MUN_SMA,
      -1,
    );
  });

  it("answers for the instant asked, so a patch beginning later is drawn about where the body will be", () => {
    const now = bodyOffsetAt(FACTS, "Kerbin", "Mun", 0, null);
    const later = bodyOffsetAt(FACTS, "Kerbin", "Mun", 60_000, null);
    expect(now).not.toBeNull();
    expect(later).not.toBeNull();
    // 60,000 s is about 0.43 of the Mun's period, so the two places are far apart.
    expect(
      Math.hypot(
        (later?.x ?? 0) - (now?.x ?? 0),
        (later?.y ?? 0) - (now?.y ?? 0),
      ),
    ).toBeGreaterThan(MUN_SMA / 2);
  });

  it("is null for a body the catalogue does not carry", () => {
    expect(bodyOffsetAt(FACTS, "Kerbin", "Duna", 0, null)).toBeNull();
    expect(bodyOffsetAt(FACTS, "Nowhere", "Mun", 0, null)).toBeNull();
  });
});
