import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { useFleetVesselPosition } from "./fleet-position";
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

    // Bare wire numbers, exactly as the dynamic topic delivers them (StubTransport,
    // like production, can't unit-wrap a per-guid topic).
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
