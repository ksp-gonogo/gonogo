import {
  DELTA_V_BUDGET,
  type DeltaVBudget,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";

/**
 * `DELTA_V_BUDGET` read the way a widget reads it: through a real
 * `TelemetryProvider`/`TelemetryClient` over a `StubTransport`, no mocked hooks.
 *
 * This file replaces `useVesselDeltaV.test.tsx`, whose subject summed
 * `dv.stages` client-side for the vessel total. The cases below pin the ruling
 * that replaced it: the total is the game's own `dv.summary` figure, and stage
 * rows alone do not produce one.
 */

function Probe({ onRender }: { onRender: (v?: DeltaVBudget) => void }) {
  onRender(useProcessor(DELTA_V_BUDGET));
  return null;
}

function renderProbe() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const renders: Array<DeltaVBudget | undefined> = [];
  render(
    <TelemetryProvider client={client}>
      <Probe onRender={(v) => renders.push(v)} />
    </TelemetryProvider>,
  );
  return { transport, renders };
}

describe("DELTA_V_BUDGET over a live stream", () => {
  /*
   * The predecessor asserted `totalVac: 0` for "no stages", which is what let a
   * SPENT vessel and an ABSENT reading be the same value all the way to the call
   * site: the maneuver planner read 0 as "unknown", showed no shortfall, and
   * left the commit enabled for a craft with nothing left to burn.
   */
  it("has no budget at all before a frame, which is not a budget of zeros", () => {
    // `useProcessor`'s disconnected contract, and the shape every consumer
    // branches on: nothing has arrived, so there is nothing to be wrong about.
    expect(renderProbe().renders.at(-1)).toBeUndefined();
  });

  it("reports null totals for an EMPTY stage list, not zero", async () => {
    // An empty `dv.stages` is not a zero-ΔV vessel: the stock sim sends
    // null-not-empty when it has nothing (StageDeltaVViewProvider.BuildStages),
    // and a spent craft's real 0 is a different fact from an absent figure.
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", []);
    });
    await waitFor(() => expect(renders.at(-1)).toBeDefined());
    const last = renders.at(-1);
    expect(last?.totalVac).toBeNull();
    expect(last?.totalAsl).toBeNull();
    expect(last?.stages).toEqual([]);
  });

  it("reports a real zero as zero, which is a different fact", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.summary", {
        stageCount: 1,
        totalDvVac: 0,
        totalDvAsl: 0,
      });
    });
    await waitFor(() => {
      expect(renders.at(-1)?.totalVac?.magnitude).toBe(0);
    });
  });

  it("takes the total off dv.summary, and 3 stage rows alone give none", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [
        { stage: 2, dvVac: 1000, dvAsl: 900 },
        { stage: 1, dvVac: 500, dvAsl: 450 },
        { stage: 0, dvVac: 250, dvAsl: 225 },
      ]);
    });
    await waitFor(() => expect(renders.at(-1)?.stages).toHaveLength(3));
    // Three rows summing to 1750 on screen, and still no vessel total: the
    // client does not add these up, because `dv.stages` (OperatingStageInfo) and
    // `dv.summary` (accumulated over WorkingStageInfo) are different lists.
    expect(renders.at(-1)?.totalVac).toBeNull();

    act(() => {
      transport.emit("dv.summary", {
        stageCount: 3,
        totalDvVac: 1900,
        totalDvAsl: 1700,
      });
    });
    // 1900, the game's figure, NOT the 1750 the rows add up to.
    await waitFor(() => expect(renders.at(-1)?.totalVac?.magnitude).toBe(1900));
    expect(renders.at(-1)?.totalAsl?.magnitude).toBe(1700);
  });

  it("maps the wire's own dvVac/dvAsl/dvActual onto the row the widgets render", async () => {
    // The mod writes `dvVac`/`dvAsl`/`dvActual`; the widgets render
    // `deltaVVac`/`deltaVASL`/`deltaVActual`. That rename is the whole of the
    // reconciliation, and it used to sit beside a fallback accepting the widget
    // spelling ON THE WIRE, which nothing has emitted since the retired legacy
    // DataSource was deleted.
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [
        { stage: 1, dvVac: 1200, dvAsl: 1000, dvActual: 1100 },
        // No ΔV figures at all: a decoupler-only stage.
        { stage: 0, dryMass: 600 },
      ]);
    });
    await waitFor(() => expect(renders.at(-1)?.stages).toHaveLength(2));
    const [upper, lower] = renders.at(-1)?.stages ?? [];
    expect(upper.deltaVVac).toBe(1200);
    expect(upper.deltaVASL).toBe(1000);
    expect(upper.deltaVActual).toBe(1100);
    // NaN, not 0: the sim had no figure, which is not the same as no ΔV.
    expect(lower.deltaVVac).toBeNaN();
    expect(lower.dryMass).toBe(600);
  });

  it("marks the active stage from vessel.structure.currentStage", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [
        { stage: 1, dvVac: 1200 },
        { stage: 0, dvVac: 600 },
      ]);
      transport.emit("vessel.structure", { currentStage: 1 });
    });
    await waitFor(() => expect(renders.at(-1)?.activeStage?.stage).toBe(1));
    expect(renders.at(-1)?.activeStage?.deltaVVac).toBe(1200);
  });
});
