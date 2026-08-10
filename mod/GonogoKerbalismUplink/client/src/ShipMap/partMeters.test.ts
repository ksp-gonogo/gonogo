import type { KerbalismProfile, VesselParts } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { computeKerbalismPartMeters } from "./partMeters";

function part(
  id: string,
  resources: Record<string, { amount: number; maxAmount: number }>,
): VesselParts["parts"][number] {
  return {
    id,
    name: id,
    title: id,
    position: { x: 0, y: 0, z: 0 },
    bounds: { size: { x: 1, y: 1, z: 1 } },
    dryMass: 0,
    inverseStage: 0,
    maxTemp: 1000,
    category: "FuelTank",
    modules: [],
    isRobotics: false,
    isPowerRelated: false,
    resources,
    moduleStates: [],
    actionBindings: [],
  } as unknown as VesselParts["parts"][number];
}

function wire(parts: VesselParts["parts"]): VesselParts {
  return { parts, meta: { source: "test", quality: 1 } };
}

const SUPPLY_PROFILE: KerbalismProfile = {
  name: "Default",
  resources: {
    Water: {
      flowMode: "STACK_PRIORITY_SEARCH",
      displayName: "Water",
      isSupply: true,
      lowThreshold: 0.2,
    },
    // Pooled: flowMode says the whole vessel shares one pool, so this must
    // NEVER earn a per-part meter even though it IS a declared Supply.
    ElectricCharge: {
      flowMode: "ALL_VESSEL_BALANCE",
      displayName: "Electric Charge",
      isSupply: true,
    },
    // Not a Supply at all (a propellant/feedstock the profile merely touches).
    Ammonia: {
      flowMode: "STACK_PRIORITY_SEARCH",
      displayName: "Ammonia",
      isSupply: false,
    },
    // flowMode unknown (unset): pooled is undefined, must be treated the
    // same as "pooled", never rendered.
    Food: {
      displayName: "Food",
      isSupply: true,
    },
  },
  rules: [],
  processes: [],
};

describe("computeKerbalismPartMeters", () => {
  it("emits a meter for a confirmed-not-pooled Supply resource", () => {
    const entries = computeKerbalismPartMeters(
      wire([part("3", { Water: { amount: 42.3, maxAmount: 180 } })]),
      SUPPLY_PROFILE,
    );
    expect(entries).toEqual([
      {
        partId: "3",
        resource: "Water",
        displayName: "Water",
        amount: 42.3,
        capacity: 180,
        status: null,
      },
    ]);
  });

  it("skips a pooled Supply resource even though it IS a declared Supply", () => {
    expect(
      computeKerbalismPartMeters(
        wire([part("1", { ElectricCharge: { amount: 50, maxAmount: 50 } })]),
        SUPPLY_PROFILE,
      ),
    ).toEqual([]);
  });

  it("skips a non-Supply resource regardless of pooling", () => {
    expect(
      computeKerbalismPartMeters(
        wire([part("2", { Ammonia: { amount: 10, maxAmount: 40 } })]),
        SUPPLY_PROFILE,
      ),
    ).toEqual([]);
  });

  it("treats unknown pooling (no flowMode) as pooled, not as confirmed-per-part", () => {
    // Honesty gate: `pooled === undefined` must never be read as `false`.
    expect(
      computeKerbalismPartMeters(
        wire([part("3", { Food: { amount: 0.4, maxAmount: 90 } })]),
        SUPPLY_PROFILE,
      ),
    ).toEqual([]);
  });

  it('flags a below-threshold reading "low", further below "critical", at-or-above threshold null', () => {
    // Status is a SEPARATE signal from the fill colour now (design doc,
    // local_docs/design/2026-08-08-resource-colour-system.md): the fill is
    // Water's own identity colour regardless of level, this only says how
    // full the tank is.
    const low = computeKerbalismPartMeters(
      wire([part("3", { Water: { amount: 27, maxAmount: 180 } })]), // 15% < 20% threshold, above critical (6.6%)
      SUPPLY_PROFILE,
    );
    expect(low[0]?.status).toBe("low");

    const critical = computeKerbalismPartMeters(
      wire([part("3", { Water: { amount: 5, maxAmount: 180 } })]), // 2.8% < critical (20% * 0.33)
      SUPPLY_PROFILE,
    );
    expect(critical[0]?.status).toBe("critical");

    const healthy = computeKerbalismPartMeters(
      wire([part("3", { Water: { amount: 100, maxAmount: 180 } })]), // 55%
      SUPPLY_PROFILE,
    );
    expect(healthy[0]?.status).toBe(null);
  });

  it("returns an empty list without a wire payload or a profile", () => {
    expect(computeKerbalismPartMeters(undefined, SUPPLY_PROFILE)).toEqual([]);
    expect(
      computeKerbalismPartMeters(wire([part("1", {})]), undefined),
    ).toEqual([]);
  });
});
