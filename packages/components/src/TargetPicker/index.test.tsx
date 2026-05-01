import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function renderPicker() {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
      <TargetPickerComponent config={{}} id="tp" />
    </DashboardItemContext.Provider>,
  );
}

describe("TargetPickerComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let onExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clearRegistry();
    onExecute = vi.fn();
    source = new MockDataSource({ keys: KEYS, onExecute });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
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

  it("renders bodies grouped by reference body and targets on click", async () => {
    renderPicker();
    primeBodies();
    fireEvent.click(screen.getByRole("button", { name: /Mun/ }));
    await waitFor(() => {
      // Mun is index 2 → tar.setTargetBody[2]
      expect(onExecute).toHaveBeenCalledWith("tar.setTargetBody[2]");
    });
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

  it("shows a coming-soon hint on the vessels tab", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    expect(screen.getByText(/kOS-backed enumeration/i)).toBeInTheDocument();
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
    expect(screen.getByText("Test Station")).toBeInTheDocument();
    expect(screen.getByText("Vessel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});
