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

function renderPicker(
  config: Parameters<typeof TargetPickerComponent>[0]["config"] = {},
) {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "tp" }}>
      <TargetPickerComponent config={config} id="tp" />
    </DashboardItemContext.Provider>,
  );
}

interface FakeKosSource {
  id: string;
  name: string;
  status: "connected";
  affectedBySignalLoss: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  schema: () => [];
  subscribe: () => () => void;
  onStatusChange: () => () => void;
  execute: () => Promise<void>;
  configSchema: () => [];
  configure: () => void;
  getConfig: () => Record<string, unknown>;
  executeScript: (
    cpu: string,
    script: string,
    args: unknown[],
  ) => Promise<Record<string, unknown>>;
}

function registerFakeKosSource(
  executeScript: FakeKosSource["executeScript"],
): FakeKosSource {
  const src: FakeKosSource = {
    id: "kos",
    name: "kOS",
    status: "connected",
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    executeScript,
  };
  registerDataSource(
    src as unknown as Parameters<typeof registerDataSource>[0],
  );
  return src;
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

  it("prompts for a kOS CPU on the vessels tab when none is configured", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    expect(
      screen.getByText(/Vessels tab needs a kOS CPU/i),
    ).toBeInTheDocument();
  });

  it("dispatches the kOS list-only script on Refresh click and renders vessels sorted by distance", async () => {
    const calls: Array<{ cpu: string; args: unknown[] }> = [];
    registerFakeKosSource(async (cpu, _script, args) => {
      calls.push({ cpu, args });
      return {
        vessels: JSON.stringify([
          { name: "Far Probe", type: "Probe", distance: 12_000 },
          { name: "Close Sat", type: "Satellite", distance: 80 },
        ]),
      };
    });
    renderPicker({ cpu: "MyCPU" });
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(screen.getByText("Close Sat")).toBeInTheDocument();
      expect(screen.getByText("Far Probe")).toBeInTheDocument();
    });
    // Sorted: Close Sat (80m) appears before Far Probe (12km) in the DOM order.
    const rows = screen.getAllByRole("button", { name: /Probe|Satellite/ });
    expect(rows[0]).toHaveTextContent("Close Sat");
    expect(rows[1]).toHaveTextContent("Far Probe");
    // List-only refresh — args come through as an empty string.
    expect(calls[0]?.args).toEqual([""]);
  });

  it("dispatches with the vessel name on click to set target via kOS", async () => {
    const calls: Array<{ args: unknown[] }> = [];
    registerFakeKosSource(async (_cpu, _script, args) => {
      calls.push({ args });
      return {
        vessels: JSON.stringify([
          { name: "Hubble Mk II", type: "Probe", distance: 200 },
        ]),
      };
    });
    renderPicker({ cpu: "MyCPU" });
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() =>
      expect(screen.getByText("Hubble Mk II")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Hubble/ }));
    await waitFor(() => {
      const last = calls[calls.length - 1];
      expect(last?.args).toEqual(["Hubble Mk II"]);
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
    expect(screen.getByText("Test Station")).toBeInTheDocument();
    expect(screen.getByText("Vessel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});
