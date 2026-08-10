import type { VesselParts } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { computeBuiltinPartMeters } from "./partMetersContribution";

/**
 * Builds one wire part with the REAL `PartResourceFlow` shape
 * (`amount`/`maxAmount` as `Value<"units">`, i.e. `{ magnitude, unit }`
 * objects, per `derivePartResources`'s `.magnitude` reads): a plain-number
 * fixture would silently produce zero entries (`undefined <= 0` is always
 * `false`, not a throw), which is exactly the kind of bug this test exists
 * to catch.
 */
function part(
  id: string,
  resources: Record<string, { amount: number; maxAmount: number }>,
): VesselParts["parts"][number] {
  const wireResources = Object.fromEntries(
    Object.entries(resources).map(([name, r]) => [
      name,
      {
        amount: { magnitude: r.amount, unit: "units" },
        maxAmount: { magnitude: r.maxAmount, unit: "units" },
      },
    ]),
  );
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
    resources: wireResources,
    moduleStates: [],
    actionBindings: [],
  } as unknown as VesselParts["parts"][number];
}

function wire(parts: VesselParts["parts"]): VesselParts {
  return { parts, meta: { source: "test", quality: 1 } };
}

describe("computeBuiltinPartMeters", () => {
  it("emits a meter per drainable resource on a part, healthy fill has no status", () => {
    const entries = computeBuiltinPartMeters(
      wire([
        part("1", {
          LiquidFuel: { amount: 90, maxAmount: 180 },
          Oxidizer: { amount: 100, maxAmount: 220 },
        }),
      ]),
    );
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({
      partId: "1",
      resource: "LiquidFuel",
      displayName: "LiquidFuel",
      amount: 90,
      capacity: 180,
      status: null,
    });
    expect(entries).toContainEqual({
      partId: "1",
      resource: "Oxidizer",
      displayName: "Oxidizer",
      amount: 100,
      capacity: 220,
      status: null,
    });
  });

  it('flags a resource below the low threshold as "low"', () => {
    const entries = computeBuiltinPartMeters(
      wire([part("1", { LiquidFuel: { amount: 20, maxAmount: 180 } })]),
    );
    expect(entries).toContainEqual({
      partId: "1",
      resource: "LiquidFuel",
      displayName: "LiquidFuel",
      amount: 20,
      capacity: 180,
      status: "low",
    });
  });

  it('flags a resource below the critical threshold as "critical"', () => {
    const entries = computeBuiltinPartMeters(
      wire([part("1", { LiquidFuel: { amount: 5, maxAmount: 180 } })]),
    );
    expect(entries).toContainEqual({
      partId: "1",
      resource: "LiquidFuel",
      displayName: "LiquidFuel",
      amount: 5,
      capacity: 180,
      status: "critical",
    });
  });

  it("ignores a resource outside the built-in five, even with capacity", () => {
    expect(
      computeBuiltinPartMeters(
        wire([part("1", { Water: { amount: 50, maxAmount: 100 } })]),
      ),
    ).toEqual([]);
  });

  it("drops a drainable resource with zero capacity (nothing to fill)", () => {
    expect(
      computeBuiltinPartMeters(
        wire([part("1", { LiquidFuel: { amount: 0, maxAmount: 0 } })]),
      ),
    ).toEqual([]);
  });

  it("returns an empty list when no wire payload has arrived yet", () => {
    expect(computeBuiltinPartMeters(undefined)).toEqual([]);
  });
});
