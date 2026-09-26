import {
  TelemetryClient,
  TelemetryProvider,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  PropagationHorizonKind,
  Quality,
  Staleness,
  type SystemBodies,
  TrajectoryKind,
} from "@ksp-gonogo/sitrep-sdk";
import type { VesselOrbitPayload } from "@ksp-gonogo/sitrep-sdk/spine";
import { StubTransport, type WireOf } from "@ksp-gonogo/sitrep-sdk/testing";
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

/**
 * The solve beside the view instant it was solved for.
 *
 * The hook answers `null` until the view clock's first frame lands, whatever
 * the elements say, because there is no instant to solve FOR yet. That frame
 * arrives on a timer a tick after the samples, so a bare `waitFor(null)` can
 * be satisfied by the pre-frame `null` and assert nothing about the rule; on a
 * fast run it passes and on a slow one it catches the solve. A test that
 * expects `null` for a REASON waits for `viewUt` first.
 */
function useSolveAtFrame() {
  return { solve: useOrbitSolve(), viewUt: useViewUt()?.magnitude };
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
   * Under physics the elements are osculating, so the conic declines to carry
   * them to the view time. A CURRENT reading still answers in full: the apsides
   * and period are algebra on the elements as they stand, and the countdowns
   * are the game's own, sent on the sample and run down by the view time since.
   */
  it("answers a loaded craft's apsides and the game's own countdowns", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useOrbitSolve(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, timeToAp: 600, timeToPe: 1500 },
        { quality: Quality.Loaded, source: "vessel:1" },
      );
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
    });

    await waitFor(() => expect(result.current?.apoapsisAlt).toBe(100_000));
    expect(result.current?.periapsisAlt).toBe(100_000);
    expect(typeof result.current?.period).toBe("number");
    // The view instant is the sample's own, so nothing has elapsed to run them
    // down by.
    expect(result.current?.timeToAp).toBe(600);
    expect(result.current?.timeToPe).toBe(1500);
    expect(result.current?.nextApsisType).toBe(1);
    expect(result.current?.timeToNextApsis).toBe(600);
  });

  /**
   * The countdowns are the game's, never the conic's: a loaded sample that
   * carries none answers the apsides and leaves every countdown absent, rather
   * than advancing osculating elements to invent one.
   */
  it("answers no countdown for a loaded sample that carries none", async () => {
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

    await waitFor(() => expect(result.current?.apoapsisAlt).toBe(100_000));
    expect(result.current?.timeToAp).toBeNull();
    expect(result.current?.timeToPe).toBeNull();
    expect(result.current?.nextApsisType).toBeNull();
    expect(result.current?.timeToNextApsis).toBeNull();
  });

  /**
   * Where the refusal still bites. A STALE reading under physics answers
   * nothing: under thrust the elements are not constants of the orbit, so old
   * ones say nothing about the orbit the craft is on now, countdowns included.
   */
  it("answers null for a STALE reading while the craft is loaded", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useSolveAtFrame(), {
      wrapper: Provider,
    });

    act(() => {
      transport.emit("system.bodies", BODIES, {
        quality: Quality.OnRails,
        source: "system:1",
      });
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, timeToAp: 600, timeToPe: 1500 },
        {
          quality: Quality.OnRails,
          source: "vessel:1",
        },
      );
    });
    // The control: the same harness does solve, so the null below is the rule.
    await waitFor(() =>
      expect(result.current.solve?.apoapsisAlt).toBe(100_000),
    );

    act(() => {
      transport.emit(
        "vessel.orbit",
        { ...ORBIT, timeToAp: 600, timeToPe: 1500 },
        {
          quality: Quality.Loaded,
          source: "vessel:1",
          staleness: Staleness.HeldStale,
        },
      );
    });

    await waitFor(() => expect(result.current.solve).toBeNull());
    expect(result.current.viewUt).toBeDefined();
  });

  /**
   * Why the solve asks where the craft is as well as how it is simulated: on
   * rails inside the air, a conic ignores the drag that is actually deciding
   * the trajectory.
   */
  it("answers null on rails below the atmosphere interface", async () => {
    const { transport, Provider } = makeHarness();
    const { result } = renderHook(() => useSolveAtFrame(), {
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

    await waitFor(() => expect(result.current.viewUt).toBeDefined());
    expect(result.current.solve).toBeNull();
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
