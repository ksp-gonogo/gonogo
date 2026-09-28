import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

// A real button click dispatches the node's real guid, resolved from `vessel.maneuver`, not its list position.
afterEach(() => {
  clearActionHandlers();
});

const CARRIED_ORBIT = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

const REAL_NODE_ID = "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e";

/** Feeds everything the telemetry gate needs; `epoch` equals `pinnedUt`, so the true anomaly is 0. */
function emitOrbitReady(fixture: ReturnType<typeof setupStreamFixture>) {
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 700000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 1_000_000,
    mu: 3.5316e12,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  });
  fixture.emit("system.bodies", {
    bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
  });
}

/**
 * Waits on the store for the frame carrying the real node id. The provider
 * coalesces frames to a microtask in jsdom, and the Delete button can appear
 * before that frame commits.
 */
async function waitForManeuverStreamFrame(
  fixture: ReturnType<typeof setupStreamFixture>,
): Promise<void> {
  await waitFor(() => {
    const point = fixture.store.sample(
      "vessel.maneuver",
      fixture.store.currentFrame(),
    );
    if (!point) throw new Error("vessel.maneuver stream frame not ready yet");
  });
}

function emitManeuverNode(fixture: ReturnType<typeof setupStreamFixture>) {
  fixture.emit("vessel.maneuver", {
    nodes: [
      {
        id: REAL_NODE_ID,
        ut: 1_000_120,
        dvRadial: 0,
        dvNormal: 0,
        dvPrograde: 30,
        dvTotal: 30,
        // The stock producer always states a basis.
        frame: ManeuverFrame.RadialNormalPrograde,
        patches: [],
      },
    ],
  });
}

describe("ManeuverPlanner: maneuver-node id round-trip", () => {
  it("Delete dispatches vessel.maneuver.remove with the REAL node id", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-cmd" }}>
          <ManeuverPlannerComponent id="mnv-cmd" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitOrbitReady(fixture);
      emitManeuverNode(fixture);
    });

    const deleteBtn = await screen.findByRole("button", {
      name: "Delete node",
    });
    await waitForManeuverStreamFrame(fixture);
    act(() => {
      deleteBtn.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.maneuver.remove", {
        nodeId: REAL_NODE_ID,
      }),
    );
  });

  it("Delete falls back to the plain positional index when no stream id has arrived at all", async () => {
    const executed: string[] = [];
    const legacyAux = await setupMockDataSource({
      keys: [],
      onExecute: (action) => {
        executed.push(action);
      },
    });

    // With no provider mounted there are no nodes, so no row renders.
    render(
      <DashboardItemContext.Provider value={{ instanceId: "mnv-no-stream" }}>
        <ManeuverPlannerComponent id="mnv-no-stream" config={{}} />
      </DashboardItemContext.Provider>,
    );

    expect(
      screen.queryByRole("button", { name: "Delete node" }),
    ).not.toBeInTheDocument();
    expect(executed).toEqual([]);

    teardownMockDataSource(legacyAux);
  });

  it("Edit (Save) dispatches vessel.maneuver.update with the REAL node id", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-edit" }}>
          <ManeuverPlannerComponent id="mnv-edit" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitOrbitReady(fixture);
      emitManeuverNode(fixture);
    });

    const user = userEvent.setup();
    const editBtn = await screen.findByRole("button", { name: "Edit node" });
    await waitForManeuverStreamFrame(fixture);
    await user.click(editBtn);

    // The default preset renders no Prograde field, so this one is the node editor's.
    const progradeLabel = screen.getByText("Prograde");
    const progradeInput = progradeLabel.parentElement?.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(progradeInput.value).toBe("30");
    await user.clear(progradeInput);
    await user.type(progradeInput, "45");

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveBtn);

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.maneuver.update", {
        nodeId: REAL_NODE_ID,
        ut: 1_000_120,
        prograde: 45,
        normal: 0,
        radialOut: 0,
      }),
    );
  });
});

/**
 * "Available" is the wire's own `dv.summary` total through the shared budget
 * processor, never the sum of `dv.stages`; the processor subscribes its own
 * dependencies.
 */
describe("ManeuverPlanner: the ΔV budget rides the stream", () => {
  it("shows the wire's own dv.summary total, not the sum of the stage rows", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-dv-stream" }}>
          <ManeuverPlannerComponent id="mnv-dv-stream" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("dv.stages")).toBe(true);
    expect(fixture.transport.isSubscribed("dv.summary")).toBe(true);

    act(() => {
      emitOrbitReady(fixture);
      // These add to 1800, against a summary of 1900.
      fixture.emit("dv.stages", [
        { stage: 1, dvVac: 1200, dvAsl: 1000, dvActual: 1100 },
        { stage: 0, dvVac: 600, dvAsl: 500, dvActual: 550 },
      ]);
      fixture.emit("dv.summary", {
        stageCount: 2,
        totalDvVac: 1900,
        totalDvAsl: 1500,
        totalDvActual: 1650,
      });
    });

    await waitFor(() => {
      expect(visibleText()).toContain("1900 m/s");
    });
    expect(visibleText()).not.toContain("1800 m/s");
  });
});
