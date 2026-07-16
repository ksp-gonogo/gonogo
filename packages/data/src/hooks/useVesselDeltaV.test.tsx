import type { StageInfo } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useVesselDeltaV } from "./useVesselDeltaV";

function fakeStage(
  partial: Partial<StageInfo> & { stage: number; deltaVVac: number },
): StageInfo {
  return {
    stageMass: 0,
    dryMass: 0,
    fuelMass: 0,
    startMass: 0,
    endMass: 0,
    burnTime: 0,
    deltaVASL: partial.deltaVVac * 0.9,
    deltaVActual: 0,
    TWRVac: 0,
    TWRASL: 0,
    TWRActual: 0,
    ispVac: 0,
    ispASL: 0,
    ispActual: 0,
    thrustVac: 0,
    thrustASL: 0,
    thrustActual: 0,
    ...partial,
  };
}

function Probe({
  onRender,
}: {
  onRender: (v: ReturnType<typeof useVesselDeltaV>) => void;
}) {
  const v = useVesselDeltaV();
  onRender(v);
  return null;
}

/**
 * `useVesselDeltaV` reads `dv.stages` via the canonical one-arg
 * `useTelemetry` — the retired `("data", "dv.stages")` shim read never had a
 * live legacy `DataSource` behind it in production (`"data"` is never
 * registered), so these tests now exercise the real
 * `TelemetryProvider`/`TelemetryClient` stream pipeline instead of a
 * `MockDataSource` under id `"data"`.
 */
describe("useVesselDeltaV", () => {
  function renderProbe() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const renders: Array<ReturnType<typeof useVesselDeltaV>> = [];
    render(
      <TelemetryProvider client={client}>
        <Probe onRender={(v) => renders.push(v)} />
      </TelemetryProvider>,
    );
    return { transport, renders };
  }

  it("returns zero totals when no stages are present", () => {
    const { renders } = renderProbe();
    expect(renders.at(-1)).toEqual({ totalVac: 0, totalASL: 0, stages: [] });
  });

  it("sums ΔV across stages", async () => {
    const { transport, renders } = renderProbe();
    act(() =>
      transport.emit("dv.stages", [
        fakeStage({ stage: 2, deltaVVac: 1000 }),
        fakeStage({ stage: 1, deltaVVac: 500 }),
        fakeStage({ stage: 0, deltaVVac: 250 }),
      ]),
    );
    await waitFor(() => expect(renders.at(-1)?.totalVac).toBe(1750));
    const last = renders.at(-1);
    expect(last?.totalASL).toBeCloseTo(1575, 5); // 0.9× sum
    expect(last?.stages).toHaveLength(3);
  });

  // `dv.stages` is UN-GAPPED (P4a shared-map batch) but rides an IDENTICAL
  // topic key off either transport — the new mod's `StageDeltaVEntry` uses
  // `dvVac`/`dvAsl` instead of the legacy `deltaVVac`/`deltaVASL`. Proves
  // the hook normalizes the new field names rather than silently summing
  // to NaN now that `dv.stages` always rides the stream (mirrors
  // FuelStatus's `parseStages` reconciliation proof).
  it("sums ΔV across stages using the new mod StageDeltaVEntry field names", async () => {
    const { transport, renders } = renderProbe();
    act(() =>
      transport.emit("dv.stages", [
        { stage: 1, dvVac: 1200, dvAsl: 1000, dvActual: 1100 },
        { stage: 0, dvVac: 600, dvAsl: 500, dvActual: 550 },
      ]),
    );
    await waitFor(() => expect(renders.at(-1)?.totalVac).toBe(1800));
    const last = renders.at(-1);
    expect(last?.totalASL).toBe(1500);
    expect(last?.stages).toHaveLength(2);
  });
});
