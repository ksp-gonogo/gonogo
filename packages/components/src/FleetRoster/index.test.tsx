import type { DataKey } from "@ksp-gonogo/core";
import {
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { FleetRosterComponent, type FleetVessel } from "./index";

const KEYS: DataKey[] = [{ key: "fleet.vessels" }];

const MIXED: FleetVessel[] = [
  {
    id: "v-station-1",
    name: "Kerbin Station Alpha",
    body: "Kerbin",
    crew: 6,
    crewCapacity: 6,
    comms: "connected",
    status: "nominal",
  },
  {
    id: "v-probe-mun",
    name: "Munar Relay Probe",
    body: "Mun",
    crew: 0,
    comms: "relay",
    status: "nominal",
  },
  {
    id: "v-lander-duna",
    name: "Duna Lander Bravo",
    body: "Duna",
    crew: 2,
    crewCapacity: 3,
    comms: "relay",
    status: "warn",
    updates: [{ text: "Battery 18% — draining", tone: "warn" }],
  },
  {
    id: "v-orbiter-eve",
    name: "Eve Orbiter Charlie",
    body: "Eve",
    crew: 1,
    crewCapacity: 1,
    comms: "none",
    status: "critical",
    updates: [{ text: "Comms blackout", tone: "nogo" }],
  },
];

const ALL_NOMINAL: FleetVessel[] = [
  {
    id: "v-a",
    name: "Station Alpha",
    body: "Kerbin",
    crew: 6,
    crewCapacity: 6,
    comms: "connected",
    status: "nominal",
  },
  {
    id: "v-b",
    name: "ComSat 1",
    body: "Kerbin",
    crew: 0,
    comms: "connected",
    status: "nominal",
  },
  {
    id: "v-c",
    name: "Transfer Vehicle",
    body: "Sun",
    crew: 3,
    crewCapacity: 4,
    comms: "relay",
    status: "nominal",
  },
];

describe("FleetRosterComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    buffered.disconnect();
  });

  function emit(vessels: FleetVessel[]) {
    act(() => {
      source.emit("fleet.vessels", vessels);
    });
  }

  function renderWidget(size = { w: 8, h: 10 }) {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
        <FleetRosterComponent
          config={{}}
          id="fleet-test"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>,
    );
  }

  it("renders a row per vessel with identity, crew and link, and a Critical fleet status", async () => {
    renderWidget();
    emit(MIXED);
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    // One row per vessel.
    expect(screen.getByText("Munar Relay Probe")).toBeInTheDocument();
    expect(screen.getByText("Duna Lander Bravo")).toBeInTheDocument();
    expect(screen.getByText("Eve Orbiter Charlie")).toBeInTheDocument();
    // Crew: capacity when known, em-dash for an uncrewed probe.
    expect(screen.getByText("6/6")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // Comms link tags.
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
    expect(screen.getByText("NONE")).toBeInTheDocument();
    // Worst-status rollup.
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("shows per-vessel line-updates for degraded vessels", async () => {
    renderWidget();
    emit(MIXED);
    await waitFor(() => {
      expect(screen.getByText("Comms blackout")).toBeInTheDocument();
    });
    expect(screen.getByText("Battery 18% — draining")).toBeInTheDocument();
  });

  it("reports a Nominal fleet with a full readiness meter when all vessels are nominal", async () => {
    renderWidget();
    emit(ALL_NOMINAL);
    await waitFor(() => {
      expect(screen.getByText("Station Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Nominal")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Fleet readiness" }),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/3 nominal/)).toBeInTheDocument();
  });

  it("shows an empty state when no vessels are tracked", async () => {
    renderWidget();
    emit([]);
    await waitFor(() => {
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument();
    });
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    emit(MIXED);
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
