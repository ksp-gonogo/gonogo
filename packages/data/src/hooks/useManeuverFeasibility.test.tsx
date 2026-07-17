import type { StageInfo } from "@ksp-gonogo/core";
import {
  type ManeuverNodeWirePayload,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useManeuverFeasibility } from "./useManeuverFeasibility";

function wireNode(id: string, ut: number, dv: number): ManeuverNodeWirePayload {
  return { id, ut, dvRadial: dv, dvNormal: 0, dvPrograde: 0, patches: [] };
}

function stage(deltaVVac: number): StageInfo {
  return {
    stage: 0,
    stageMass: 0,
    dryMass: 0,
    fuelMass: 0,
    startMass: 0,
    endMass: 0,
    burnTime: 0,
    deltaVVac,
    deltaVASL: deltaVVac,
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
  };
}

function Probe({
  onRender,
}: {
  onRender: (f: ReturnType<typeof useManeuverFeasibility>) => void;
}) {
  const f = useManeuverFeasibility();
  onRender(f);
  return null;
}

/**
 * `useManeuverFeasibility` composes `useManeuverNodes` (`vessel.maneuver.legacy`)
 * and `useVesselDeltaV` (`dv.stages`) — both now real stream reads, so these
 * tests emit the raw `vessel.maneuver`/`dv.stages` wire topics through a real
 * `TelemetryProvider`/`TelemetryClient` instead of a `MockDataSource` under id
 * `"data"` (which never backed either read in production).
 */
describe("useManeuverFeasibility", () => {
  function renderProbe() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(
      <TelemetryProvider client={client}>
        <Probe onRender={(f) => renders.push(f)} />
      </TelemetryProvider>,
    );
    return { transport, renders };
  }

  it("empty plan → allOk with zero required", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("vessel.maneuver", { nodes: [] });
      transport.emit("dv.stages", [stage(2000)]);
    });
    await waitFor(() => expect(renders.at(-1)?.available).toBe(2000));
    const last = renders.at(-1);
    expect(last?.allOk).toBe(true);
    expect(last?.totalRequired).toBe(0);
  });

  it("two feasible nodes → allOk and remaining decreases", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [stage(2000)]);
      transport.emit("vessel.maneuver", {
        nodes: [wireNode("a", 100, 500), wireNode("b", 200, 500)],
      });
    });
    await waitFor(() => expect(renders.at(-1)?.totalRequired).toBe(1000));
    const last = renders.at(-1);
    expect(last?.allOk).toBe(true);
    expect(last?.nodes[0].remainingDeltaV).toBe(1500);
    expect(last?.nodes[1].remainingDeltaV).toBe(1000);
  });

  it("last node goes short when cumulative ΔV exceeds available", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [stage(800)]);
      transport.emit("vessel.maneuver", {
        nodes: [wireNode("a", 100, 500), wireNode("b", 200, 500)],
      });
    });
    await waitFor(() => expect(renders.at(-1)?.anyShort).toBe(true));
    const last = renders.at(-1);
    expect(last?.nodes[0].ok).toBe(true);
    expect(last?.nodes[1].ok).toBe(false);
  });

  it("sorts by UT so feasibility reflects execution order", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.stages", [stage(800)]);
      // Emit out of UT order — the hook should sort.
      transport.emit("vessel.maneuver", {
        nodes: [wireNode("b", 200, 500), wireNode("a", 100, 500)],
      });
    });
    await waitFor(() =>
      expect(renders.at(-1)?.nodes.map((n) => n.node.UT)).toEqual([100, 200]),
    );
  });

  it("returns ok=null when ΔV telemetry is absent", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("vessel.maneuver", {
        nodes: [wireNode("a", 100, 500)],
      });
      // Never emit dv.stages — useVesselDeltaV returns totalVac=0.
    });
    await waitFor(() => expect(renders.at(-1)?.nodes).toHaveLength(1));
    const last = renders.at(-1);
    expect(last?.nodes[0].ok).toBeNull();
    expect(last?.allOk).toBe(false);
    expect(last?.anyShort).toBe(false);
  });
});
