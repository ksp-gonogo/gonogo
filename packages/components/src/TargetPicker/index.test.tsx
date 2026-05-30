import type { DataKey } from "@gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  { key: "tar.availableVessels" },
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
    renderPicker();
    primeBodies();
    fireEvent.click(screen.getByRole("button", { name: /Mun/ }));
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

  it("filters the list as the user types", () => {
    renderPicker();
    primeBodies();
    fireEvent.change(screen.getByLabelText("Filter bodies"), {
      target: { value: "mun" },
    });
    expect(screen.queryByRole("button", { name: /Kerbol/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mun/ })).toBeInTheDocument();
  });

  it("renders vessels from tar.availableVessels sorted by distance", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    act(() => {
      source.emit("tar.availableVessels", [
        {
          index: 5,
          name: "Far Probe",
          type: "Probe",
          situation: "ORBITING",
          body: "Kerbin",
          // 12 km vector
          position: [12_000, 0, 0],
        },
        {
          index: 9,
          name: "Close Sat",
          type: "Satellite",
          situation: "ORBITING",
          body: "Kerbin",
          // ~80 m vector
          position: [80, 0, 0],
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.getByText("Close Sat")).toBeInTheDocument();
      expect(screen.getByText("Far Probe")).toBeInTheDocument();
    });
    const rows = screen.getAllByRole("button", {
      name: /Close Sat|Far Probe/,
    });
    expect(rows[0]).toHaveTextContent("Close Sat");
    expect(rows[1]).toHaveTextContent("Far Probe");
  });

  it("clicking a vessel row fires tar.setTargetVessel with its server index", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    act(() => {
      source.emit("tar.availableVessels", [
        {
          index: 12,
          name: "Hubble Mk II",
          type: "Probe",
          situation: "ORBITING",
          body: "Kerbin",
          position: [200, 0, 0],
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText("Hubble Mk II")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Hubble/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.setTargetVessel[12]");
    });
  });

  it("renders current target details and clears via tar.clearTarget", async () => {
    renderPicker();
    act(() => {
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.distance", 1500);
      source.emit("tar.o.relativeVelocity", -2.5);
    });
    fireEvent.click(screen.getByRole("tab", { name: "Current" }));
    expect(screen.getAllByText("Test Station").length).toBeGreaterThan(0);
    expect(screen.getByText("Vessel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});
