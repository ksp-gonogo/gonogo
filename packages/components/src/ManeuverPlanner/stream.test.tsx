import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * Stream test-adapter proof for ManeuverPlanner's maneuver-node id
 * round-trip: `o.maneuverNodes` (behind `useManeuverNodes`) now reads the
 * `vessel.maneuver.legacy` derived channel (reshaping the real
 * `vessel.maneuver` wire topic), and the id round-trips via the SAME raw
 * `vessel.maneuver` read (`resolveNodeId` in index.tsx) to feed the real
 * guid into the update/remove commands instead of a positional array
 * index. This is what "un-gapping o.updateManeuverNode/
 * o.removeManeuverNode" (map-command.ts) actually proves end-to-end: a real
 * button click, correlated across the two independently-timed reads,
 * dispatching the right id.
 *
 * `vessel.maneuver.legacy` isn't one of the two derived channels
 * `setupStreamFixture` pre-registers (`vesselStateChannel`/
 * `spaceCenterStateChannel`): register it locally via
 * `fixture.store.registerDerivedChannel(...)`.
 *
 * Every OTHER telemetry read this widget makes (`o.sma`/`o.eccentricity`/
 * `o.ApR`/`o.PeR`/`o.timeToAp`/`o.timeToPe`/`o.orbitalSpeed`/`o.radius` off
 * `vessel.orbit`/the derived `vessel.state`, `t.universalTime` off
 * `useViewUt()`) has moved to a canonical Topic read with NO legacy
 * fallback (see `index.tsx`): there is no `setupMockDataSource` leg left
 * in this file at all; `emitOrbitReady` feeds the real
 * `vessel.orbit` wire topic instead.
 */
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

/**
 * Feeds `vessel.orbit` in the default (OnRails) quality so the derived
 * `vessel.state`'s ApR/PeR/timeToAp/timeToPe/orbitalSpeed/orbitalRadius/mu
 * inputs all resolve: everything `ManeuverPlannerComponent`'s
 * `telemetryStatus` gate needs to clear the "Waiting for telemetry" panel.
 * `epoch` == `pinnedUt` so `trueAnomaly` lands exactly at periapsis (0°),
 * matching the legacy fixture's `o.trueAnomaly: 0`.
 */
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
  });
}

/**
 * `TelemetryProvider` coalesces `beginFrame()` to a microtask in jsdom (no
 * `requestAnimationFrame`, see `context.tsx`'s own doc comment): a plain
 * `act()` around `transport.emit` doesn't guarantee that microtask has
 * actually run by the time a synchronous `.click()` fires right after. The
 * "Delete node" button itself appears as soon as the streamed
 * `vessel.maneuver.legacy` read lands (a separate, synchronous path), so
 * it's not a reliable proxy for "the raw `vessel.maneuver` frame carrying
 * the real node id has committed too." Wait on the store directly instead
 * of racing it.
 */
async function waitForManeuverStreamFrame(fixture: {
  store: {
    sample: (topic: string, frame: unknown) => unknown;
    currentFrame: () => unknown;
  };
}): Promise<void> {
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
        // Stated, because `StockManeuverPlanBackend` states it: a node with no
        // basis is a shape the stock producer never sends, and the editor
        // rightly declines to put stock's words on one.
        frame: ManeuverFrame.RadialNormalPrograde,
        patches: [],
      },
    ],
  });
}

describe("ManeuverPlanner: maneuver-node id round-trip (M3 vessel-gap batch)", () => {
  it("Delete dispatches vessel.maneuver.remove with the REAL node id when vessel.maneuver.remove is carried", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        ...CARRIED_ORBIT,
        "vessel.maneuver",
        "vessel.maneuver.remove",
      ],
      pinnedUt: 1_000_000,
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

  it("Delete still dispatches vessel.maneuver.remove with the REAL id even when the command topic isn't in the carried allowlist", async () => {
    // useCommand (delayed-command-ux migration) dispatches unconditionally
    // via the client, no carried-channels gate and no legacy DataSource
    // fallback: the allowlist below deliberately omits
    // "vessel.maneuver.remove" (the READ, "vessel.maneuver", still is, so
    // the real id resolves) to prove the command topic being un-carried no
    // longer matters.
    const fixture = setupStreamFixture({
      carriedChannels: [...CARRIED_ORBIT, "vessel.maneuver"],
      pinnedUt: 1_000_000,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "mnv-cmd-uncarried" }}
        >
          <ManeuverPlannerComponent id="mnv-cmd-uncarried" config={{}} />
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

    // No TelemetryProvider mounted at all: `vessel.maneuver.legacy` never
    // resolves, so `useManeuverNodes` returns an empty list and no node row
    // (hence no "Delete node" button) renders. This case is now covered by
    // the plain-index unit path on `resolveNodeId` directly instead (see
    // `index.test.tsx`): nothing left to exercise here now that
    // `o.maneuverNodes` has no legacy fallback of its own to fall back to.
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
      carriedChannels: [
        ...CARRIED_ORBIT,
        "vessel.maneuver",
        "vessel.maneuver.update",
      ],
      pinnedUt: 1_000_000,
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

    // Default preset -> the "New maneuver" section's own Prograde field
    // isn't rendered, so only the node editor's is on screen (same
    // established pattern as index.test.tsx's own maneuver-edit test).
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
 * The planner's "Available" figure comes off the wire's own `dv.summary` total,
 * through the shared `DELTA_V_BUDGET` processor, and NOT from adding up
 * `dv.stages`.
 *
 * That is the whole of the ruling, so the case emits three stage rows adding to
 * 1800 alongside a summary that says 1900, and demands 1900 on screen. It used
 * to demand 1800, which was the client's own arithmetic over
 * `OperatingStageInfo` presented as the vessel total that KSP accumulates over
 * `WorkingStageInfo`: a different list, and a figure the game never agreed with.
 *
 * The processor also has to SUBSCRIBE its own deps, since the widget no longer
 * reads either topic itself; `isSubscribed` below is what says so. The ΔV total
 * only renders once `!waiting` (`telemetryStatus` all-clear), so
 * `emitOrbitReady` feeds the rest of the widget's telemetry too.
 */
describe("ManeuverPlanner: the ΔV budget rides the stream", () => {
  it("shows the wire's own dv.summary total, not the sum of the stage rows", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [...CARRIED_ORBIT, "dv.stages", "dv.summary"],
      pinnedUt: 1_000_000,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-dv-stream" }}>
          <ManeuverPlannerComponent id="mnv-dv-stream" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Subscribed by the processor's own dep walk, not by the widget: nothing in
    // ManeuverPlanner reads either topic directly any more.
    expect(fixture.transport.isSubscribed("dv.stages")).toBe(true);
    expect(fixture.transport.isSubscribed("dv.summary")).toBe(true);

    act(() => {
      emitOrbitReady(fixture);
      // The mod's real StageDeltaVEntry field names (contract.ts:491),
      // `dvVac`/`dvAsl`, NOT the legacy `deltaVVac`/`deltaVASL`. These add to
      // 1800, which must NOT be what the widget shows.
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
