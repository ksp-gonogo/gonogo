import { wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import type { VesselOrbitPayload } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { propagateVesselOrbit, useFleetVesselPosition } from "./fleet-position";
import { StubTransport } from "./stub-transport";

// End-to-end regression for the seam gap #1 lived in: a RAW (un-unit-wrapped)
// dynamic fleet.<guid>.orbit payload must flow through useFleetVesselPosition ->
// wrap-by-type -> buildElements -> kepler.solve and come out a FINITE position,
// not NaN. If the hook forgot to wrap the raw bare numbers, buildElements' mag()
// would produce NaN and this asserts "finite", not "NaN".
function PosProbe({ guid }: { guid: string }) {
  const p = useFleetVesselPosition(guid);
  const state =
    p == null ? "none" : Number.isFinite(p.position[0]) ? "finite" : "NaN";
  return <div>{`pos:${state}`}</div>;
}

describe("useFleetVesselPosition (through the real store)", () => {
  it("dead-reckons a finite position from a raw dynamic fleet.<guid>.orbit", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <PosProbe guid="g1" />
      </TelemetryProvider>,
    );

    // Bare wire numbers, exactly as the dynamic topic delivers them (StubTransport, like production, can't unit-wrap a per-guid topic).
    act(() => {
      t.emit("fleet.g1.orbit", {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.1,
        inc: 30,
        lan: 40,
        argPe: 50,
        meanAnomalyAtEpoch: 0.5,
        epoch: 0,
        mu: 3.5316e12,
      });
    });

    await waitFor(() => expect(screen.getByText("pos:finite")).toBeTruthy());
  });
});

describe("useFleetVesselPosition under signal delay", () => {
  const UT_NOW = 10_000;
  const ORBIT = {
    referenceBodyIndex: 1,
    sma: 700_000,
    ecc: 0.1,
    inc: 30,
    lan: 40,
    argPe: 50,
    meanAnomalyAtEpoch: 0.5,
    epoch: 0,
    mu: 3.5316e12,
  };

  /** The fleet vessel's x position when its elements, taken at `UT_NOW - owlt`, arrive at `UT_NOW`. */
  async function positionAtLightTime(owlt: number): Promise<number> {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let x = Number.NaN;
    function Probe() {
      const p = useFleetVesselPosition("g1");
      if (p) x = p.position[0];
      return <div>{p ? "pos" : "none"}</div>;
    }
    render(
      <TelemetryProvider
        client={client}
        viewClockOptions={{
          nowWall: () => 0,
          warpRate: () => 1,
          delaySeconds: () => owlt,
        }}
      >
        <Probe />
      </TelemetryProvider>,
    );
    act(() => {
      t.emit("fleet.g1.orbit", ORBIT, {
        validAt: UT_NOW - owlt,
        deliveredAt: UT_NOW,
      });
    });
    await waitFor(() => expect(Number.isFinite(x)).toBe(true));
    return x;
  }

  it("places the vessel at the received edge, not at the craft's present", async () => {
    const atCraft = await positionAtLightTime(0);
    const delayed = await positionAtLightTime(240);
    expect(delayed).not.toBeCloseTo(atCraft, 0);
    expect(delayed).toBeCloseTo(
      propagateVesselOrbit(
        wrapTypePayload<VesselOrbitPayload>("VesselOrbit", { ...ORBIT }),
        UT_NOW - 240,
      )?.position[0] ?? Number.NaN,
      3,
    );
  });
});
