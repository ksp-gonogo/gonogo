import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

/**
 * The body tree rides `system.bodies` off the stream (`useCelestialBodies`);
 * the target-detail scalars now read canonically too — `tarName` off
 * `vessel.target.name` and `tarType`/`tarDistance`/`tarRelVel` off the
 * `vessel.state` derived channel (`targetKind`/`targetDistance`/
 * `targetRelativeSpeed`), both via one-arg stream reads with no legacy
 * fallback. `MockDataSource` stays wired only for the `tar.*` command
 * execution (`useExecuteAction("data")`) and the `tar.availableVessels`
 * legacy status read (`useDataStreamStatus`, no one-arg form yet).
 */
const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "tar.name" },
  { key: "tar.type" },
  { key: "tar.distance" },
  { key: "tar.o.relativeVelocity" },
];

function renderPicker(
  fixture: StreamFixture,
  config: Parameters<typeof TargetPickerComponent>[0]["config"] = {},
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
        <TargetPickerComponent config={config} id="tp" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("TargetPickerComponent", () => {
  let dataFixture: MockDataSourceFixture;
  let fixture: StreamFixture;
  let onExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onExecute = vi.fn();
    dataFixture = await setupMockDataSource({ keys: KEYS, onExecute });
    fixture = setupStreamFixture({
      carriedChannels: ["system.bodies"],
      pinnedUt: 0,
    });
  });

  afterEach(() => {
    teardownMockDataSource(dataFixture);
  });

  // Kerbol → Kerbin → Mun, streamed as system.bodies (parentIndex tree).
  function primeBodies() {
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          { index: 0, name: "Kerbol", parentIndex: null, orbit: null },
          {
            index: 1,
            name: "Kerbin",
            parentIndex: 0,
            gravParameter: 1.1723328e18,
            orbit: {
              sma: 13_599_840_256,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
          {
            index: 2,
            name: "Mun",
            parentIndex: 1,
            gravParameter: 3.5316e12,
            orbit: {
              sma: 12_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
        ],
      });
    });
  }

  it("waits for body data on the bodies tab", () => {
    renderPicker(fixture);
    expect(screen.getByText(/Waiting for body data/i)).toBeInTheDocument();
  });

  it("treats the Telemachus no-target sentinel as no target", () => {
    // Telemachus' tar.name returns the literal "No Target Selected." (not ""
    // or null) when nothing is targeted. The compact readout (w<4||h<6) must
    // show its no-target branch, never the sentinel as a phantom target name.
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
          <TargetPickerComponent config={{}} id="tp" w={3} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.target", { name: "No Target Selected." });
    });
    expect(screen.getByText(/No target set/i)).toBeInTheDocument();
    expect(screen.queryByText(/No Target Selected\./)).not.toBeInTheDocument();
  });

  it("renders bodies grouped by reference body and targets on click", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    primeBodies();
    await user.click(await screen.findByRole("button", { name: /Mun/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.setTargetBody[2]");
    });
  });

  it("treats a root star (no parent) and its descendants as a tree", async () => {
    // system.bodies fixes Telemachus's "star lists itself as parent" wart at
    // the source: the root has parentIndex null, so it's a root and its
    // children hang off it via the parentIndex tree.
    renderPicker(fixture);
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          { index: 0, name: "Sun", parentIndex: null, orbit: null },
          { index: 1, name: "Kerbin", parentIndex: 0, orbit: null },
          { index: 2, name: "Mun", parentIndex: 1, orbit: null },
        ],
      });
    });
    expect(
      await screen.findByRole("button", { name: /Sun/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kerbin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  it("surfaces orphan bodies as roots when their parent isn't in the tree", async () => {
    renderPicker(fixture);
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          // parentIndex 5 isn't present → referenceBody resolves null → root.
          { index: 1, name: "Kerbin", parentIndex: 5, orbit: null },
          { index: 2, name: "Mun", parentIndex: 1, orbit: null },
        ],
      });
    });
    expect(
      await screen.findByRole("button", { name: /Kerbin/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  it("filters the list as the user types", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    primeBodies();
    const filter = screen.getByLabelText("Filter bodies");
    await user.clear(filter);
    await user.type(filter, "mun");
    expect(screen.queryByRole("button", { name: /Kerbol/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  // The Vessels tab reads the `system.vessels` roster canonically off the
  // stream — roster rendering and click-to-target are covered by
  // `stream.test.tsx`.

  it("renders current target details and clears via tar.clearTarget", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    act(() => {
      // tarType/tarDistance/tarRelVel read off the `vessel.state` derived
      // channel, which stays a whole-record `undefined` until its
      // `vessel.orbit`/`vessel.flight` inputs land (deriveVesselState's own
      // "not whole yet" gate) — Loaded quality skips the OnRails Kepler
      // solve entirely, same minimal-unblock pattern as AtmosphereProfile/
      // MapView's stream tests.
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        altitudeAsl: 0,
        verticalSpeed: 0,
        surfaceSpeed: 0,
        orbitalSpeed: 0,
      });
      // kind: 0 -> targetKind "Vessel" (TARGET_KIND_NAMES). relativePosition
      // magnitude 1500 -> targetDistance; dot(relPos, relVel)/|relPos| ==
      // -2.5 -> targetRelativeSpeed (closing).
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
        relativeVelocity: { x: -2.5, y: 0, z: 0 },
      });
    });
    await user.click(screen.getByRole("tab", { name: "Current" }));
    // The target-detail fields land off the derived `vessel.state` channel,
    // one scheduled store frame after the raw `vessel.target` emit — waitFor
    // tolerates that microtask hop instead of asserting synchronously.
    await waitFor(() => {
      expect(screen.getAllByText("Test Station").length).toBeGreaterThan(0);
      expect(screen.getByText("Vessel")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});

describe("TargetPicker — augment slots (Uplink architecture spec §4)", () => {
  let dataFixture: MockDataSourceFixture;
  let fixture: StreamFixture;

  beforeEach(async () => {
    dataFixture = await setupMockDataSource({ keys: KEYS });
    fixture = setupStreamFixture({
      carriedChannels: ["system.bodies"],
      pinnedUt: 0,
    });
  });

  afterEach(() => {
    teardownMockDataSource(dataFixture);
    clearAugments();
  });

  it("exposes the two host slots empty by default (no augment DOM)", () => {
    renderPicker(fixture);
    // Neither slot has a bound augment, so nothing extra renders — the frame is
    // unchanged from before the slots existed. Registry-side, both are exposable.
    expect(getAugmentsForSlot("target-picker.sections")).toHaveLength(0);
    expect(getAugmentsForSlot("target-picker.badges")).toHaveLength(0);
    expect(screen.queryByText("FLEET FILTER")).toBeNull();
    expect(screen.queryByText("LINK")).toBeNull();
  });

  it("renders an augment bound to the body sections slot", () => {
    registerAugment({
      id: "test-fleet-filter",
      augments: "target-picker.sections",
      component: () => <div>FLEET FILTER</div>,
    });
    renderPicker(fixture);
    expect(
      getAugmentsForSlot("target-picker.sections").map((a) => a.id),
    ).toEqual(["test-fleet-filter"]);
    expect(screen.getByText("FLEET FILTER")).toBeInTheDocument();
  });

  it("renders an augment bound to the header badges slot", () => {
    registerAugment({
      id: "test-badge",
      augments: "target-picker.badges",
      component: () => <span>LINK</span>,
    });
    renderPicker(fixture);
    expect(getAugmentsForSlot("target-picker.badges").map((a) => a.id)).toEqual(
      ["test-badge"],
    );
    expect(screen.getByText("LINK")).toBeInTheDocument();
  });
});
