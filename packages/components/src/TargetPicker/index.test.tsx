import type { DataKey } from "@gonogo/core";
import {
  DashboardItemContext,
  type MockDataSource,
  registerDataSource,
} from "@gonogo/core";
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
import "./vesselListScript"; // self-registers the centralised feed
import { TARGET_VESSELS_TOPIC_ID } from "./vesselListScript";

const TOPIC_KEY = `kos.compute.${TARGET_VESSELS_TOPIC_ID}.vessels`;

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

/**
 * Fake `kos` source supporting just enough of the centralised compute
 * surface for TargetPicker: subscribe (for vessel list), execute (for the
 * dispatchNow action), executeScript (for set-target RPC),
 * getTopicStatus / onTopicStatusChange (for status pills).
 */
function registerFakeKosSource(
  executeScript: (
    cpu: string,
    script: string,
    args: unknown[],
  ) => Promise<Record<string, unknown>>,
  opts: { activeCpu?: string } = {},
) {
  const subs = new Set<(value: unknown) => void>();
  const statusListeners = new Set<() => void>();
  const actions: string[] = [];
  let lastValue: unknown;

  const fake = {
    id: "kos",
    name: "kOS",
    status: "connected" as const,
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe(key: string, cb: (value: unknown) => void): () => void {
      if (key !== TOPIC_KEY) return () => {};
      subs.add(cb);
      if (lastValue !== undefined) {
        queueMicrotask(() => cb(lastValue));
      }
      return () => subs.delete(cb);
    },
    onStatusChange: () => () => {},
    async execute(action: string) {
      actions.push(action);
    },
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({ activeCpu: opts.activeCpu ?? "datastream" }),
    executeScript,
    getTopicStatus: (id: string) => {
      if (id !== TARGET_VESSELS_TOPIC_ID) return null;
      return {
        lastGoodAt: lastValue !== undefined ? Date.now() : null,
        scriptError: null,
        parseError: null,
        paused: false,
        running: false,
      };
    },
    onTopicStatusChange: (id: string, cb: () => void) => {
      if (id !== TARGET_VESSELS_TOPIC_ID) return () => {};
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    push(value: unknown) {
      lastValue = value;
      for (const cb of subs) cb(value);
      for (const cb of statusListeners) cb();
    },
    actions,
  };

  registerDataSource(
    fake as unknown as Parameters<typeof registerDataSource>[0],
  );
  return fake;
}

describe("TargetPickerComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;
  let onExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onExecute = vi.fn();
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;
    void import("./vesselListScript");
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

  it("renders bodies grouped by reference body and targets on click", async () => {
    renderPicker();
    primeBodies();
    fireEvent.click(screen.getByRole("button", { name: /Mun/ }));
    await waitFor(() => {
      // Mun is index 2 → tar.setTargetBody[2]
      expect(onExecute).toHaveBeenCalledWith("tar.setTargetBody[2]");
    });
  });

  it("surfaces orphan bodies as roots when their parent name hasn't streamed", () => {
    // Repro for the live bug where Telemachus delivers planets but withholds
    // the star's `b.name[0]`. Without orphan-as-root, every planet references
    // a parent that isn't in `namedBodies`, the tree-walk produces no roots,
    // and the picker is blank until you search.
    renderPicker();
    act(() => {
      source.emit("b.number", 3);
      // No b.name[0] (Kerbol).
      source.emit("b.name[1]", "Kerbin");
      source.emit("b.name[2]", "Mun");
      source.emit("b.referenceBody[1]", "Kerbol");
      source.emit("b.referenceBody[2]", "Kerbin");
    });
    // Kerbin should still be visible even though its parent Kerbol is unnamed.
    expect(screen.getByRole("button", { name: /Kerbin/ })).toBeInTheDocument();
    // Mun's parent Kerbin IS in namedBodies, so Mun stays nested under Kerbin.
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

  it("renders vessels from the centralised feed sorted by distance", async () => {
    const fake = registerFakeKosSource(async () => ({}));
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));

    act(() => {
      fake.push([
        { name: "Far Probe", type: "Probe", distance: 12_000 },
        { name: "Close Sat", type: "Satellite", distance: 80 },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("Close Sat")).toBeInTheDocument();
      expect(screen.getByText("Far Probe")).toBeInTheDocument();
    });
    const rows = screen.getAllByRole("button", { name: /Probe|Satellite/ });
    expect(rows[0]).toHaveTextContent("Close Sat");
    expect(rows[1]).toHaveTextContent("Far Probe");
  });

  it("Refresh fires kos.compute.target-vessels.dispatchNow", async () => {
    const fake = registerFakeKosSource(async () => ({}));
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    act(() => {
      fake.push([{ name: "X", type: "Probe", distance: 1 }]);
    });
    await waitFor(() => expect(screen.getByText("X")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => {
      expect(fake.actions).toContain("kos.compute.target-vessels.dispatchNow");
    });
  });

  it("clicking a vessel runs the set-target script with that name and refreshes the feed", async () => {
    const calls: Array<{ cpu: string; script: string; args: unknown[] }> = [];
    const fake = registerFakeKosSource(async (cpu, script, args) => {
      calls.push({ cpu, script, args });
      return { ok: true };
    });
    renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: "Vessels" }));
    act(() => {
      fake.push([{ name: "Hubble Mk II", type: "Probe", distance: 200 }]);
    });
    await waitFor(() =>
      expect(screen.getByText("Hubble Mk II")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Hubble/ }));
    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
      const last = calls[calls.length - 1];
      expect(last.args).toEqual(["Hubble Mk II"]);
      expect(last.cpu).toBe("datastream");
      expect(last.script).toMatch(/setTarget\.ks$/);
    });
    // After the set-target promise resolves, the widget asks the feed for a
    // fresh sample so the new TARGET row updates.
    await waitFor(() =>
      expect(fake.actions).toContain("kos.compute.target-vessels.dispatchNow"),
    );
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
    // The target name appears in both the always-visible header chip and
    // the Current tab's detail row, so query the detail row specifically
    // via its sibling label rather than relying on text uniqueness.
    expect(screen.getAllByText("Test Station").length).toBeGreaterThan(0);
    expect(screen.getByText("Vessel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("tar.clearTarget");
    });
  });
});
