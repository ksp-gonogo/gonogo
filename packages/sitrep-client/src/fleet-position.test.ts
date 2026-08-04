import { wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { propagateVesselOrbit } from "./fleet-position";
import { solve } from "./kepler";
import { buildElements, type VesselOrbitPayload } from "./vessel-state";

// `wrapTypePayload` turns bare wire numbers into the `{ magnitude }` Value shape
// production hands the client (what `parseServerMessage` / `useStream` deliver),
// so the fixture is exactly what `propagateVesselOrbit` sees at runtime.
function orbit(overrides: Record<string, unknown> = {}): VesselOrbitPayload {
  return wrapTypePayload("VesselOrbit", {
    referenceBodyIndex: 1,
    sma: 700_000,
    ecc: 0.1,
    inc: 30,
    lan: 40,
    argPe: 50,
    meanAnomalyAtEpoch: 0.5,
    epoch: 0,
    mu: 3.5316e12,
    ...overrides,
  }) as VesselOrbitPayload;
}

describe("propagateVesselOrbit", () => {
  it("matches solve(buildElements(orbit), ut) exactly (reuses the path, no new math)", () => {
    const o = orbit();
    const ut = 1234;
    expect(propagateVesselOrbit(o, ut)).toEqual(solve(buildElements(o), ut));
  });

  it("returns null for a hyperbolic orbit instead of throwing", () => {
    expect(propagateVesselOrbit(orbit({ ecc: 1.4 }), 0)).toBeNull();
  });
});
