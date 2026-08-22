import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
  type WireOf,
} from "@ksp-gonogo/sitrep-client";
import { Quality, type SystemBodies } from "@ksp-gonogo/sitrep-sdk";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useOrbitElements } from "./useOrbitElements";

/**
 * `useOrbitElements` now reads the native `vessel.state` derived channel
 * (`@ksp-gonogo/sitrep-client`'s `deriveVesselState`) via `useStream`, the
 * same channel `Targeting`/`TargetPicker`/`ManeuverPlanner`/
 * `CurrentOrbit` read for their own `vessel.state.*` fields, no more legacy
 * `useTelemetry("data", "o.ApR")`-style two-arg reads, no more `dataSourceId`
 * parameter (there is exactly one `vessel.state` channel to read).
 *
 * `apoapsisRadius`/`periapsisRadius`/`timeToAp`/`timeToPe` only populate in
 * the OnRails ("propagated") basis (`vessel-state.ts`'s `deriveVesselState`),
 * so every `vessel.orbit` emission below carries `Quality.OnRails`.
 * `apoapsisAlt`/`periapsisAlt` additionally need `system.bodies` for the
 * reference body's radius.
 */
const ORBIT: WireOf<VesselOrbitPayload> = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

// `orbit` is absent rather than null: `BodyEntry.orbit` is optional on the
// contract, and the reference-body lookup below only reads `radius`.
const BODIES: WireOf<SystemBodies> = {
  bodies: [{ name: "Kerbin", index: 1, parentIndex: 0, radius: 600_000 }],
};

function makeHarness() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  function Provider({ children }: { children: ReactNode }) {
    return <TelemetryProvider client={client}>{children}</TelemetryProvider>;
  }
  return { transport, client, Provider };
}

describe("useOrbitElements", () => {
  it("returns all-undefined fields before any value is emitted", () => {
    const { Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitElements(), {
      wrapper: Provider,
    });

    expect(result.current).toEqual({
      apoapsisRadius: undefined,
      periapsisRadius: undefined,
      apoapsisAltitude: undefined,
      periapsisAltitude: undefined,
      timeToApoapsis: undefined,
      timeToPeriapsis: undefined,
    });
  });

  it("returns undefined for every field when no TelemetryProvider is mounted", () => {
    const { result } = renderHook(() => useOrbitElements());

    expect(result.current).toEqual({
      apoapsisRadius: undefined,
      periapsisRadius: undefined,
      apoapsisAltitude: undefined,
      periapsisAltitude: undefined,
      timeToApoapsis: undefined,
      timeToPeriapsis: undefined,
    });
  });

  it("surfaces derived values for every key once vessel.orbit + system.bodies arrive", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitElements(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.OnRails,
        source: "vessel:1",
      });
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });

    // sma·(1±ecc) with ecc=0 -> ApR = PeR = 700_000; apoapsisAlt/periapsisAlt
    // subtract the Kerbin radius (600_000) -> 100_000. A circular orbit has
    // no well-defined time-to-apoapsis/periapsis "next pass" distinction:
    // both resolve to *some* finite countdown off the (arbitrary at ecc=0)
    // mean anomaly, so only assert they're finite numbers.
    await waitFor(() => expect(result.current.apoapsisRadius).toBe(700_000));
    expect(result.current.periapsisRadius).toBe(700_000);
    expect(result.current.apoapsisAltitude).toBe(100_000);
    expect(result.current.periapsisAltitude).toBe(100_000);
    expect(typeof result.current.timeToApoapsis).toBe("number");
    expect(typeof result.current.timeToPeriapsis).toBe("number");
  });

  it("propagates updates as new orbit elements arrive", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitElements(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.OnRails,
        source: "vessel:1",
      });
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });
    await waitFor(() => expect(result.current.apoapsisAltitude).toBe(100_000));

    act(() => {
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, sma: 900_000 },
        { quality: Quality.OnRails, source: "vessel:1" },
      );
    });

    await waitFor(() => expect(result.current.apoapsisAltitude).toBe(300_000));
    expect(result.current.periapsisAltitude).toBe(300_000);
  });

  it("passes apoapsisRadius through as null (not undefined) for a hyperbolic orbit, CurrentOrbit's hasOrbit gate depends on this", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitElements(), {
      wrapper: Provider,
    });

    act(() => {
      // ecc >= 1 -> hyperbolic; deriveVesselState's apoapsisRadius is an
      // explicit `null` here (no apoapsis on a hyperbolic trajectory) while
      // periapsisRadius stays a real finite number: see vessel-state.ts's
      // isHyperbolic doc.
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, sma: -2_400_000, ecc: 1.283 },
        { quality: Quality.OnRails, source: "vessel:1" },
      );
    });

    await waitFor(() =>
      expect(result.current.periapsisRadius).toBeCloseTo(
        -2_400_000 * (1 - 1.283),
      ),
    );
    // `null`, genuinely arrived: NOT `undefined` ("hasn't arrived yet").
    expect(result.current.apoapsisRadius).toBeNull();
    expect(result.current.apoapsisRadius).not.toBeUndefined();
  });

  it("clears all fields to undefined on a vessel.orbit tombstone", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitElements(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.OnRails,
        source: "vessel:1",
      });
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });
    await waitFor(() => expect(result.current.apoapsisRadius).toBe(700_000));

    act(() => {
      transport.emit("vessel.orbit", null, {
        quality: Quality.OnRails,
        source: "vessel:1",
      });
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        apoapsisRadius: undefined,
        periapsisRadius: undefined,
        apoapsisAltitude: undefined,
        periapsisAltitude: undefined,
        timeToApoapsis: undefined,
        timeToPeriapsis: undefined,
      }),
    );
  });
});
