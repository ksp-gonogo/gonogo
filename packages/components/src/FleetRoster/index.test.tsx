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
      // A real CommNet read of "no link home" — a confirmed ops fact, not an
      // absence. vesselType 0 (Ship), not Station — this is a crewed craft,
      // not a habitat.
      vesselId: "v-orbiter-eve",
      name: "Eve Orbiter Charlie",
      vesselType: 0,
      situation: 3,
      bodyIndex: 3,
      crewCount: 1,
      crewCapacity: 1,
      commsConnected: false,
      commsControlSource: RosterCommsControlSource.None,
    },
    {
      // Real, honest zeros for crew (Part.CrewCapacity sums to 0 for debris —
      // ProtoVessel.GetVesselCrew()/partPrefab.CrewCapacity both resolve
      // cleanly), but comms fields are OMITTED — verified against
      // CommNet.CommNetVessel.OnStart (decompile): VesselType.Debris never
      // gets a CommNetVessel attached at all, so this is the vessel's
      // permanent state, not a glitch.
      vesselId: "v-debris",
      name: "Stage 2 Debris",
      vesselType: 9,
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      // Same structural reason as debris — CommNetVessel.OnStart's guard
      // excludes VesselType.SpaceObject too — but crew is still a real,
      // resolvable zero.
      vesselId: "v-asteroid",
      name: "Ast. XC7-142",
      vesselType: 10,
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      // No crew/comms/body fields at all — the producer's own transient
      // "could not read this tick" case (BuildVesselRosterEntry's try/catch
      // default, or a not-yet-resolved protoVessel/orbitDriver on a
      // freshly-spawned vessel) — distinct from debris/asteroid above, whose
      // missing comms is a permanent, structural state with perfectly real
      // crew data. Must render as an honest unknown, never a fabricated
      // zero/no-link.
      vesselId: "v-unresolved",
      name: "New Contact",
      vesselType: 14,
      situation: 2,
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
      vesselType: 0,
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
    expect(screen.getByText("Stage 2 Debris")).toBeInTheDocument();
    expect(screen.getByText("Ast. XC7-142")).toBeInTheDocument();
    expect(screen.getByText("New Contact")).toBeInTheDocument();
    // Body names resolved via system.bodies. Kerbin appears three times (the
    // station, the debris entry and the asteroid all orbit it); the
    // unresolved contact has no resolvable body at all.
    expect(screen.getAllByText("Kerbin")).toHaveLength(3);
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText("Duna")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
    // Crew: the debris and asteroid entries both report a real, honest 0/0
    // (their crew read succeeded — only their comms read is structurally
    // absent), same as the probe's real 0/0. Only the fully-unresolved
    // contact renders an em-dash for crew.
    expect(screen.getAllByText("0/0")).toHaveLength(3);
    expect(screen.getByText("6/6")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    // Em-dashes: the unresolved contact's Body AND Crew cells (2), plus the
    // Link column's "unknown" tag on the debris, the asteroid, and the
    // unresolved contact (3) — five in total.
    expect(screen.getAllByText("—")).toHaveLength(5);
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
    // Four vessels are not linked (1 none + 3 unknown: debris, asteroid,
    // unresolved contact) out of seven.
    expect(screen.getByText("4 Not Linked")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "43");
    expect(screen.getByText(/3 linked/)).toBeInTheDocument();
    expect(screen.getByText(/1 no link/)).toBeInTheDocument();
    expect(screen.getByText(/3 unknown/)).toBeInTheDocument();
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
