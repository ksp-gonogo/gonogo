import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  type MockDataSource,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { TargetPickerComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "b.number" },
  { key: "b.name[0]" },
  { key: "b.name[1]" },
  { key: "b.name[2]" },
  { key: "b.referenceBody[0]" },
  { key: "b.referenceBody[1]" },
  { key: "b.referenceBody[2]" },
  { key: "tar.name" },
  { key: "tar.type" },
  { key: "tar.distance" },
  { key: "tar.o.relativeVelocity" },
];

function renderPicker(
  config: Parameters<typeof TargetPickerComponent>[0]["config"] = {},
) {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
      <TargetPickerComponent config={config} id="tp" />
    </DashboardItemContext.Provider>,
  );
}

describe("TargetPickerComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;
  let onExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onExecute = vi.fn();
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  function primeBodies() {
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "Kerbol");
      source.emit("b.name[1]", "Kerbin");
      source.emit("b.name[2]", "Mun");
      source.emit("b.referenceBody[1]", "Kerbol");
      source.emit("b.referenceBody[2]", "Kerbin");
    });
  }

  it("waits for body data on the bodies tab", () => {
    renderPicker();
    expect(screen.getByText(/Waiting for body data/i)).toBeInTheDocument();
  });

  it("treats the Telemachus no-target sentinel as no target", () => {
    // Telemachus' tar.name returns the literal "No Target Selected." (not ""
    // or null) when nothing is targeted. The compact readout (w<4||h<6) must
    // show its no-target branch, never the sentinel as a phantom target name.
    render(
      <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
        <TargetPickerComponent config={{}} id="tp" w={3} h={4} />
      </DashboardItemContext.Provider>,
    );
    act(() => {
      source.emit("tar.name", "No Target Selected.");
    });
    expect(screen.getByText(/No target set/i)).toBeInTheDocument();
    expect(screen.queryByText(/No Target Selected\./)).not.toBeInTheDocument();
  });

  it("renders bodies grouped by reference body and targets on click", async () => {
    const user = userEvent.setup();
    renderPicker();
    primeBodies();
    await user.click(screen.getByRole("button", { name: /Mun/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.setTargetBody[2]");
    });
  });

  it("treats a self-referencing star as a root (b.referenceBody[0] = its own name)", () => {
    renderPicker();
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "Sun");
      source.emit("b.name[1]", "Kerbin");
      source.emit("b.name[2]", "Mun");
      source.emit("b.referenceBody[0]", "Sun");
      source.emit("b.referenceBody[1]", "Sun");
      source.emit("b.referenceBody[2]", "Kerbin");
    });
    expect(screen.getByRole("button", { name: /Sun/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kerbin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  it("surfaces orphan bodies as roots when their parent name hasn't streamed", () => {
    renderPicker();
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[1]", "Kerbin");
      source.emit("b.name[2]", "Mun");
      source.emit("b.referenceBody[1]", "Kerbol");
      source.emit("b.referenceBody[2]", "Kerbin");
    });
    expect(screen.getByRole("button", { name: /Kerbin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  it("filters the list as the user types", async () => {
    const user = userEvent.setup();
    renderPicker();
    primeBodies();
    const filter = screen.getByLabelText("Filter bodies");
    await user.clear(filter);
    await user.type(filter, "mun");
    expect(screen.queryByRole("button", { name: /Kerbol/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  // The Vessels tab now reads the `system.vessels` roster canonically off the
  // stream (no legacy `tar.availableVessels` array shape), so roster rendering
  // and click-to-target are covered by `stream.test.tsx`, which drives the real
  // TelemetryProvider pipeline. This file keeps the legacy-fallback coverage
  // for the shape-compatible scalar reads (bodies, current-target details).

  it("renders current target details and clears via tar.clearTarget", async () => {
    const user = userEvent.setup();
    renderPicker();
    act(() => {
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.distance", 1500);
      source.emit("tar.o.relativeVelocity", -2.5);
    });
    await user.click(screen.getByRole("tab", { name: "Current" }));
    expect(screen.getAllByText("Test Station").length).toBeGreaterThan(0);
    expect(screen.getByText("Vessel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});

describe("TargetPicker — augment slots (Uplink architecture spec §4)", () => {
  let fixture: MockDataSourceFixture;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearAugments();
  });

  it("exposes the two host slots empty by default (no augment DOM)", () => {
    renderPicker();
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
    renderPicker();
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
    renderPicker();
    expect(getAugmentsForSlot("target-picker.badges").map((a) => a.id)).toEqual(
      ["test-badge"],
    );
    expect(screen.getByText("LINK")).toBeInTheDocument();
  });
});
