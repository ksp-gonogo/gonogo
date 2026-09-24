import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
  type WireOf,
} from "@ksp-gonogo/sitrep-client";
import {
  PropagationHorizonKind,
  Quality,
  type SystemBodies,
  TrajectoryKind,
} from "@ksp-gonogo/sitrep-sdk";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useOrbitSolve } from "./useOrbitSolve";

/**
 * `useOrbitSolve` reads `vessel.orbit` and solves its elements for the view
 * instant, asking the conic's own reckoning first. Every emission below states
 * its quality, because that is one of the five things the conic withdraws on
 * and the difference between a solve and no solve at all.
 *
 * `horizon` is stated rather than omitted for the same reason: an unbounded,
 * analytic reach is the claim every stock host makes, and leaving it off would
 * be testing against a producer that vouched for nothing.
 */
const HORIZON = {
  kind: PropagationHorizonKind.Unbounded,
  trajectoryKind: TrajectoryKind.Analytic,
};

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
  horizon: HORIZON,
};

/*
 * `orbit` is absent rather than null: `BodyEntry.orbit` is optional on the
 * contract, and the reference-body lookup only reads `radius`. No atmosphere,
 * so the conic's floor is the bare surface and a 700 km orbit clears it.
 */
const BODIES: WireOf<SystemBodies> = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600_000,
      horizon: HORIZON,
    },
  ],
};

function makeHarness() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  function Provider({ children }: { children: ReactNode }) {
    return <TelemetryProvider client={client}>{children}</TelemetryProvider>;
  }
  return { transport, client, Provider };
}

describe("useOrbitSolve", () => {
  it("answers null before any elements have arrived", () => {
    const { Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
      wrapper: Provider,
    });

    expect(result.current).toBeNull();
  });

  it("answers null when no TelemetryProvider is mounted", () => {
    const { result } = renderHook(() => useOrbitSolve());

    expect(result.current).toBeNull();
  });

  it("solves every field once vessel.orbit + system.bodies arrive on rails", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
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

    // sma·(1±ecc) with ecc=0 -> ApR = PeR = 700_000; the altitudes subtract
    // Kerbin's radius (600_000) -> 100_000. A circular orbit has no
    // well-defined "next" apsis distinction: both countdowns resolve to some
    // finite value off the (arbitrary at ecc=0) mean anomaly, so only assert
    // they are finite numbers.
    await waitFor(() => expect(result.current?.apoapsisRadius).toBe(700_000));
    expect(result.current?.periapsisRadius).toBe(700_000);
    expect(result.current?.apoapsisAlt).toBe(100_000);
    expect(result.current?.periapsisAlt).toBe(100_000);
    expect(typeof result.current?.timeToAp).toBe("number");
    expect(typeof result.current?.timeToPe).toBe("number");
    expect(typeof result.current?.period).toBe("number");
  });

  /**
   * The slice's whole point, and the behaviour `vessel.state` used to get by
   * picking on quality itself. Under physics the elements are osculating: the
   * conic declines, so there is nothing to solve and the widgets that read this
   * draw the absence rather than a number computed from elements nothing is
   * propagating.
   */
  it("answers null while the craft is loaded, because the conic withdraws", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });

    // The elements themselves ARRIVED; only the model refused. Assert after a
    // settled frame so this is not just reading the pre-emission null.
    await waitFor(() => expect(result.current).toBeNull());
    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  /**
   * The condition `vessel.state`'s quality pick could not express, and the
   * reason this is a widening rather than a like-for-like move. On rails inside
   * the air, a conic ignores the drag that is actually deciding the trajectory.
   */
  it("answers null on rails below the atmosphere interface", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, sma: 655_000, ecc: 0.01 },
        { quality: Quality.OnRails, source: "vessel:1" },
      );
      transport.emit(
        "system.bodies",
        {
          bodies: [
            { ...BODIES.bodies[0], atmosphere: { depth: 70_000 } },
          ] as WireOf<SystemBodies>["bodies"],
        },
        { quality: Quality.OnRails, source: "system:1" },
      );
    });

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("re-solves as new elements arrive", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
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
    await waitFor(() => expect(result.current?.apoapsisAlt).toBe(100_000));

    act(() => {
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, sma: 900_000 },
        { quality: Quality.OnRails, source: "vessel:1" },
      );
    });

    await waitFor(() => expect(result.current?.apoapsisAlt).toBe(300_000));
    expect(result.current?.periapsisAlt).toBe(300_000);
  });

  it("gives a null apoapsis on a hyperbolic orbit while the periapsis stays real", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
      wrapper: Provider,
    });

    act(() => {
      // ecc >= 1: an escape/flyby. The elliptical solver has no apoapsis to
      // give, and `sma·(1+ecc)` is finite-but-meaningless with sma < 0, so the
      // solve says `null` rather than letting a finite guard pass it through.
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, sma: -2_400_000, ecc: 1.283 },
        { quality: Quality.OnRails, source: "vessel:1" },
      );
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });

    await waitFor(() =>
      expect(result.current?.periapsisRadius).toBeCloseTo(
        -2_400_000 * (1 - 1.283),
      ),
    );
    // A solve that EXISTS and says this quantity does not, which is a different
    // statement from the whole-solve `null` above.
    expect(result.current).not.toBeNull();
    expect(result.current?.apoapsisRadius).toBeNull();
  });

  it("answers null on a vessel.orbit tombstone", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
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
    await waitFor(() => expect(result.current?.apoapsisRadius).toBe(700_000));

    act(() => {
      transport.emit("vessel.orbit", null, {
        quality: Quality.OnRails,
        source: "vessel:1",
      });
    });

    await waitFor(() => expect(result.current).toBeNull());
  });
});
