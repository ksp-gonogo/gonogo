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

/**
 * The wire's own vessel total, which is where the available ΔV comes from.
 *
 * These cases used to emit `dv.stages` and let the client add the rows up. It no
 * longer does: `dv.stages` is `OperatingStageInfo` and this is accumulated over
 * `WorkingStageInfo`, so the sum was a second, quieter answer to a question the
 * game had already answered.
 */
function budget(totalDvVac: number) {
  return {
    stageCount: 1,
    totalDvVac,
    totalDvAsl: totalDvVac,
    totalDvActual: totalDvVac,
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
 * and the shared `DELTA_V_BUDGET` processor (`dv.summary`): both real stream
 * reads, so these tests emit the raw `vessel.maneuver`/`dv.summary` wire topics
 * through a real `TelemetryProvider`/`TelemetryClient` instead of a
 * `MockDataSource` under id `"data"` (which never backed either read).
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
      transport.emit("dv.summary", budget(2000));
    });
    await waitFor(() => expect(renders.at(-1)?.available).toBe(2000));
    const last = renders.at(-1);
    expect(last?.allOk).toBe(true);
    expect(last?.totalRequired).toBe(0);
  });

  it("two feasible nodes → allOk and remaining decreases", async () => {
    const { transport, renders } = renderProbe();
    act(() => {
      transport.emit("dv.summary", budget(2000));
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
      transport.emit("dv.summary", budget(800));
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
      transport.emit("dv.summary", budget(800));
      // Emit out of UT order: the hook should sort.
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
      // Never emit dv.summary: the budget has no total, which is not zero.
    });
    await waitFor(() => expect(renders.at(-1)?.nodes).toHaveLength(1));
    const last = renders.at(-1);
    expect(last?.nodes[0].ok).toBeNull();
    expect(last?.allOk).toBe(false);
    expect(last?.anyShort).toBe(false);
  });
});
