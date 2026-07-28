import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetRosterComponent } from "./index";

/**
 * FleetRoster runs entirely off the real stream: `system.vessels` (every
 * known vessel, loaded or not — KspHost.BuildVesselRosterEntry's capture-add)
 * plus `system.bodies` to resolve each entry's `bodyIndex` to a display
 * name. There is no legacy `MockDataSource`/`fleet.vessels` registered here —
 * that key never existed at runtime (see the FleetRoster stub-fix commit);
 * this is the real `TelemetryProvider`/`TimelineStore` pipeline via
 * `setupStreamFixture`.
 */

const BODIES = {
  bodies: [
    { index: 0, name: "Kerbin" },
    { index: 1, name: "Mun" },
    { index: 2, name: "Duna" },
    { index: 3, name: "Eve" },
  ],
};

const MIXED = {
  vessels: [
    {
      vesselId: "v-station-1",
      name: "Kerbin Station Alpha",
      vesselType: 1,
      situation: 3,
      bodyIndex: 0,
      crewCount: 6,
      crewCapacity: 6,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-probe-mun",
      name: "Munar Relay Probe",
      vesselType: 3,
      situation: 3,
      bodyIndex: 1,
      crewCount: 0,
      crewCapacity: 0,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Partial,
    },
    {
      vesselId: "v-lander-duna",
      name: "Duna Lander Bravo",
      vesselType: 2,
      situation: 0,
      bodyIndex: 2,
      crewCount: 2,
      crewCapacity: 3,
      commsConnected: true,
      commsControlSource: RosterCommsControlSource.Partial,
    },
    {
      vesselId: "v-orbiter-eve",
      name: "Eve Orbiter Charlie",
      vesselType: 1,
      situation: 3,
      bodyIndex: 3,
      crewCount: 1,
      crewCapacity: 1,
      commsConnected: false,
      commsControlSource: RosterCommsControlSource.None,
    },
    {
      // No crew/comms fields at all — the producer's own "could not read
      // this tick" case (BuildVesselRosterEntry's try/catch default). Must
      // render as an honest unknown, never a fabricated zero/no-link.
      vesselId: "v-debris",
      name: "Unresolvable Debris",
      vesselType: 9,
      situation: 3,
      bodyIndex: 0,
    },
  ],
};

const ALL_LINKED = {
  vessels: [
    {
      vesselId: "v-a",
      name: "Station Alpha",
      vesselType: 1,
      situation: 3,
      bodyIndex: 0,
      crewCount: 6,
      crewCapacity: 6,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-b",
      name: "ComSat 1",
      vesselType: 3,
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-c",
      name: "Transfer Vehicle",
      vesselType: 1,
      situation: 3,
      bodyIndex: 0,
      crewCount: 3,
      crewCapacity: 4,
      commsControlSource: RosterCommsControlSource.Partial,
    },
  ],
};

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["system.vessels", "system.bodies"],
    pinnedUt: 10,
  });
}

function renderRoster(
  fixture: ReturnType<typeof newFixture>,
  size = { w: 8, h: 10 },
) {
  const { unmount, container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
        <FleetRosterComponent
          config={{}}
          id="fleet-test"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
});

describe("FleetRosterComponent", () => {
  it("renders a row per vessel with identity, body, crew and link", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    // One row per vessel.
    expect(screen.getByText("Munar Relay Probe")).toBeInTheDocument();
    expect(screen.getByText("Duna Lander Bravo")).toBeInTheDocument();
    expect(screen.getByText("Eve Orbiter Charlie")).toBeInTheDocument();
    expect(screen.getByText("Unresolvable Debris")).toBeInTheDocument();
    // Body names resolved via system.bodies. Kerbin appears twice (the
    // station and the debris entry both orbit it).
    expect(screen.getAllByText("Kerbin")).toHaveLength(2);
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText("Duna")).toBeInTheDocument();
    // Crew: capacity when known, em-dash for the unresolvable entry. The
    // unresolvable entry's crew AND link cells both render "—", so two
    // em-dashes are expected on the page.
    expect(screen.getByText("6/6")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    // Comms link tags: direct / relay / none / unknown.
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
    expect(screen.getAllByText("RELAY")).toHaveLength(2);
    expect(screen.getByText("NONE")).toBeInTheDocument();
  });

  it("rolls the fleet up into a comms-coverage badge and meter, never a health verdict", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    // Two vessels are not linked (none + unknown) out of five.
    expect(screen.getByText("2 Not Linked")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText(/3 linked/)).toBeInTheDocument();
    expect(screen.getByText(/1 no link/)).toBeInTheDocument();
    expect(screen.getByText(/1 unknown/)).toBeInTheDocument();
  });

  it("shows an All Linked badge and a full meter when every vessel has a link", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", ALL_LINKED);
    });
    await waitFor(() => {
      expect(screen.getByText("Station Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("All Linked")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders a bound fleet-roster.updates augment per vessel row, carrying identity", async () => {
    registerAugment<"fleet-roster.updates">({
      id: "test-fleet-update",
      augments: "fleet-roster.updates",
      component: ({ vesselId }) => (
        <span data-testid="fleet-update" data-vessel={vesselId} />
      ),
    });

    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", ALL_LINKED);
    });

    const updates = await screen.findAllByTestId("fleet-update");
    expect(updates).toHaveLength(3);
    expect(updates.map((u) => u.dataset.vessel)).toEqual(["v-a", "v-b", "v-c"]);
  });

  it("shows a genuinely-empty state once a real empty roster has arrived", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", { vessels: [] });
    });
    await waitFor(() => {
      expect(screen.getByText("No vessels tracked.")).toBeInTheDocument();
    });
  });

  it("shows a not-available state before any roster has ever arrived, distinct from a genuinely empty fleet", () => {
    const fixture = newFixture();
    renderRoster(fixture);
    expect(
      screen.getByText("Fleet data not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No vessels tracked.")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const container = renderRoster(fixture);
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", MIXED);
    });
    await waitFor(() => {
      expect(screen.getByText("Kerbin Station Alpha")).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
