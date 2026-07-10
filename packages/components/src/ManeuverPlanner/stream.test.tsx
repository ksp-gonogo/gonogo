import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * The M3 vessel-gap batch's stream test-adapter proof for ManeuverPlanner's
 * maneuver-node id round-trip: `o.maneuverNodes` (behind `useManeuverNodes`)
 * itself STAYS a legacy/gapped read — the new `vessel.maneuver.nodes` shape
 * has no deltaV tuple or post-burn orbit preview (map-topic.ts's
 * TELEMACHUS_KNOWN_GAPS) — but the id round-trips (M3 R3) via the new,
 * narrower `o.maneuverNodeIds` read, and `resolveNodeId` (index.tsx) uses it
 * to feed the real guid into the update/remove commands instead of a
 * positional array index. This is what "un-gapping
 * o.updateManeuverNode/o.removeManeuverNode" (map-command.ts) actually
 * proves end-to-end: a real button click, correlated across the two
 * independently-timed reads, dispatching the right id.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

const READY_TELEMETRY: Record<string, unknown> = {
  "o.sma": 700000,
  "o.eccentricity": 0.01,
  "o.ApR": 707000,
  "o.PeR": 693000,
  "o.ApA": 107000,
  "o.PeA": 93000,
  "o.argumentOfPeriapsis": 0,
  "o.trueAnomaly": 0,
  "o.timeToAp": 900,
  "o.timeToPe": 1800,
  "o.inclination": 0,
  "o.period": 3600,
  "o.orbitalSpeed": 2300,
  "o.radius": 700000,
  "t.universalTime": 1_000_000,
  "a.physicsMode": "stock",
  // One legacy-shaped node at array position 0 — RADIAL, NORMAL, PROGRADE
  // wire order (see index.tsx's handleEdit/dispatchPlanBurns doc comment).
  "o.maneuverNodes": [{ UT: 1_000_120, deltaV: [0, 0, 30], orbitPatch: null }],
};

const REAL_NODE_ID = "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e";

function emitReadyTelemetry(source: { emit: (k: string, v: unknown) => void }) {
  for (const [key, value] of Object.entries(READY_TELEMETRY)) {
    source.emit(key, value);
  }
}

/**
 * `TelemetryProvider` coalesces `beginFrame()` to a microtask in jsdom (no
 * `requestAnimationFrame`, see `context.tsx`'s own doc comment) — a plain
 * `act()` around `transport.emit` doesn't guarantee that microtask has
 * actually run by the time a synchronous `.click()` fires right after. The
 * "Delete node" button itself appears as soon as the LEGACY
 * `o.maneuverNodes` read lands (a separate, synchronous path), so it's not
 * a reliable proxy for "the stream frame carrying the real node id has
 * committed too." Wait on the store directly instead of racing it.
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

describe("ManeuverPlanner — maneuver-node id round-trip (M3 vessel-gap batch)", () => {
  it("Delete dispatches vessel.maneuver.remove with the REAL node id when vessel.maneuver.remove is carried", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.maneuver", "vessel.maneuver.remove"],
      pinnedUt: 10,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(READY_TELEMETRY).map((key) => ({ key })),
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-cmd" }}>
          <ManeuverPlannerComponent id="mnv-cmd" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitReadyTelemetry(legacyAux.source);
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: REAL_NODE_ID,
            ut: 1_000_120,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 30,
            dvTotal: 30,
          },
        ],
      });
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

    teardownMockDataSource(legacyAux);
  });

  it("Delete falls back to legacy execute() with the resolved id when vessel.maneuver.remove isn't carried", async () => {
    const fixture = setupStreamFixture({
      // Read IS carried (so the real id resolves) — only the COMMAND isn't.
      carriedChannels: ["vessel.maneuver"],
      pinnedUt: 10,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    const executed: string[] = [];
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(READY_TELEMETRY).map((key) => ({ key })),
      connectSource: true,
      onExecute: (action) => {
        executed.push(action);
      },
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-cmd-legacy" }}>
          <ManeuverPlannerComponent id="mnv-cmd-legacy" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitReadyTelemetry(legacyAux.source);
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: REAL_NODE_ID,
            ut: 1_000_120,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 30,
            dvTotal: 30,
          },
        ],
      });
    });

    const deleteBtn = await screen.findByRole("button", {
      name: "Delete node",
    });
    await waitForManeuverStreamFrame(fixture);
    act(() => {
      deleteBtn.click();
    });

    // The real id still resolved (the READ is carried) — it's the command
    // dispatch itself that falls back to the legacy DataSource, carrying
    // that same resolved id along with it (map-command.ts's documented
    // accepted-risk note for this edge case).
    await waitFor(() =>
      expect(executed).toEqual([`o.removeManeuverNode[${REAL_NODE_ID}]`]),
    );
    expect(commandHandler).not.toHaveBeenCalled();

    teardownMockDataSource(legacyAux);
  });

  it("Delete falls back to the plain positional index when no stream id has arrived at all", async () => {
    const executed: string[] = [];
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(READY_TELEMETRY).map((key) => ({ key })),
      connectSource: true,
      onExecute: (action) => {
        executed.push(action);
      },
    });

    // No TelemetryProvider mounted at all — the fully-unmigrated case,
    // matching every widget's behavior before this batch.
    render(
      <DashboardItemContext.Provider value={{ instanceId: "mnv-no-stream" }}>
        <ManeuverPlannerComponent id="mnv-no-stream" config={{}} />
      </DashboardItemContext.Provider>,
    );

    act(() => {
      emitReadyTelemetry(legacyAux.source);
    });

    const deleteBtn = await screen.findByRole("button", {
      name: "Delete node",
    });
    act(() => {
      deleteBtn.click();
    });

    await waitFor(() => expect(executed).toEqual(["o.removeManeuverNode[0]"]));

    teardownMockDataSource(legacyAux);
  });

  it("Edit (Save) dispatches vessel.maneuver.update with the REAL node id", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.maneuver", "vessel.maneuver.update"],
      pinnedUt: 10,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(READY_TELEMETRY).map((key) => ({ key })),
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-edit" }}>
          <ManeuverPlannerComponent id="mnv-edit" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      emitReadyTelemetry(legacyAux.source);
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: REAL_NODE_ID,
            ut: 1_000_120,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 30,
            dvTotal: 30,
          },
        ],
      });
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

    teardownMockDataSource(legacyAux);
  });
});

/**
 * P4a shared-map batch proof, separate from the M3 node-id round-trip
 * above: `dv.stages` is UN-GAPPED (map-topic.ts's TELEMACHUS_CLEAN_HOMES,
 * whole-topic identity read) and now rides the stream once carried, with
 * zero change to the `useVesselDeltaV()` call site in index.tsx. The two
 * transports disagree on field names though — legacy `StageInfo`
 * (`deltaVVac`/`deltaVASL`) vs. the new mod's `StageDeltaVEntry`
 * (`dvVac`/`dvAsl`) — so this proves `useVesselDeltaV`'s `normalizeStage`
 * reconciliation actually feeds the widget's rendered "Available" ΔV
 * figure, not just the legacy shape `index.test.tsx` already covers.
 * `a.physicsMode` has no stream equivalent (STAYS HYBRID per the P4a
 * brief), so the legacy `DataSource` still supplies every OTHER telemetry
 * key here.
 */
describe("ManeuverPlanner — dv.stages read rides the stream (P4a shared-map batch)", () => {
  it("sums the ΔV available total off dv.stages using the new mod StageDeltaVEntry field names", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["dv.stages"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(READY_TELEMETRY).map((key) => ({ key })),
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-dv-stream" }}>
          <ManeuverPlannerComponent id="mnv-dv-stream" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("dv.stages")).toBe(true);

    act(() => {
      emitReadyTelemetry(legacyAux.source);
      // The mod's real StageDeltaVEntry field names (contract.ts:491) —
      // `dvVac`/`dvAsl`, NOT the legacy `deltaVVac`/`deltaVASL`.
      fixture.emit("dv.stages", [
        { stage: 1, dvVac: 1200, dvAsl: 1000, dvActual: 1100 },
        { stage: 0, dvVac: 600, dvAsl: 500, dvActual: 550 },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("1800 m/s")).toBeInTheDocument();
    });

    teardownMockDataSource(legacyAux);
  });
});
