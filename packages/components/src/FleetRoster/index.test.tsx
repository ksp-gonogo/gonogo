import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  visibleText,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetRosterComponent } from "./index";

/**
 * FleetRoster runs entirely off the real stream: `system.vessels` (every
 * known vessel, loaded or not, KspHost.BuildVesselRosterEntry's capture-add)
 * plus `system.bodies` to resolve each entry's `bodyIndex` to a display
 * name. There is no legacy `MockDataSource`/`fleet.vessels` registered here,
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
      // A real CommNet read of "no link home", a confirmed ops fact, not an
      // absence. vesselType 0 (Ship), not Station, this is a crewed craft,
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
      // No crew/comms/body fields at all - the producer's own transient
      // "could not read this tick" case (BuildVesselRosterEntry's try/catch
      // default, or a not-yet-resolved protoVessel/orbitDriver on a
      // freshly-spawned vessel). vesselType 14 (Unknown) is NOT filtered out
      // by isRosterCraft - an unclassified vessel is a real "we don't know"
      // fact, not license to make the row vanish. Must render as an honest
      // unknown, never a fabricated zero/no-link.
      vesselId: "v-unresolved",
      name: "New Contact",
      vesselType: 14,
      situation: 2,
    },
  ],
};

/**
 * Every non-craft `VesselType` the roster must filter out, plus one real
 * craft and one genuinely-unclassified contact as controls. Debris and
 * asteroids are the two the operator explicitly flagged, but the same
 * "not a vehicle" reasoning applies to a planted flag, an EVA kerbal, and
 * Kerbalism-style deployed science hardware - see isRosterCraft's own doc
 * comment for why each is excluded.
 */
const NON_CRAFT = {
  vessels: [
    {
      vesselId: "v-craft",
      name: "Craft One",
      vesselType: 4, // Rover
      situation: 0,
      bodyIndex: 0,
      crewCount: 1,
      crewCapacity: 1,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-eva",
      name: "Jebediah on EVA",
      vesselType: 7, // EVA
      situation: 5,
    },
    {
      vesselId: "v-flag",
      name: "Flag Planted at KSC",
      vesselType: 8, // Flag
      situation: 0,
    },
    {
      // Real, honest zeros for crew (Part.CrewCapacity sums to 0 for debris -
      // ProtoVessel.GetVesselCrew()/partPrefab.CrewCapacity both resolve
      // cleanly), but comms fields are OMITTED - verified against
      // CommNet.CommNetVessel.OnStart (decompile): VesselType.Debris never
      // gets a CommNetVessel attached at all, so this is the vessel's
      // permanent state, not a glitch. Must not render at all now.
      vesselId: "v-debris",
      name: "Stage 2 Debris",
      vesselType: 9, // Debris
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      // Same structural reason as debris - CommNetVessel.OnStart's guard
      // excludes VesselType.SpaceObject too. Must not render at all now.
      vesselId: "v-asteroid",
      name: "Ast. XC7-142",
      vesselType: 10, // SpaceObject
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
    },
    {
      vesselId: "v-sci-controller",
      name: "Deployed Science Controller",
      vesselType: 11, // DeployedScienceController
      situation: 0,
    },
    {
      vesselId: "v-sci-part",
      name: "Deployed Science Part",
      vesselType: 12, // DeployedSciencePart
      situation: 0,
    },
    {
      vesselId: "v-dropped-part",
      name: "Dropped Part",
      vesselType: 13, // DroppedPart
      situation: 0,
    },
    {
      // Unclassified, NOT a confirmed non-craft type - must still render.
      vesselId: "v-unclassified",
      name: "New Contact",
      vesselType: 14, // Unknown
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
    expect(screen.getByText("New Contact")).toBeInTheDocument();
    // Body names resolved via system.bodies. Each craft orbits a distinct
    // body; the unresolved contact has no resolvable body at all.
    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText("Duna")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
    // Crew: the probe's real, honest 0/0; the rest are distinct crewed
    // counts. Only the fully-unresolved contact renders an em-dash for crew.
    expect(visibleText()).toContain("0/0");
    expect(visibleText()).toContain("6/6");
    expect(visibleText()).toContain("2/3");
    expect(visibleText()).toContain("1/1");
    // Em-dashes: the unresolved contact's Body cell, Crew cell, and the Link
    // column's "unknown" tag - three in total.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(3);
    // Comms link tags: direct / relay / none / unknown.
    expect(screen.getByText("DIRECT")).toBeInTheDocument();
    expect(screen.getAllByText("RELAY")).toHaveLength(2);
    expect(screen.getByText("NONE")).toBeInTheDocument();
  });

  it("filters non-craft vessel types out of the roster, keeping real craft and one unclassified contact", async () => {
    const fixture = newFixture();
    renderRoster(fixture);
    act(() => {
      fixture.emit("system.vessels", NON_CRAFT);
    });
    await waitFor(() => {
      expect(screen.getByText("Craft One")).toBeInTheDocument();
    });
    // The one truly-unclassified entry still renders (never silently
    // dropped) alongside the real craft.
    expect(screen.getByText("New Contact")).toBeInTheDocument();
    // Every confirmed non-craft type is filtered out entirely.
    expect(screen.queryByText("Jebediah on EVA")).not.toBeInTheDocument();
    expect(screen.queryByText("Flag Planted at KSC")).not.toBeInTheDocument();
    expect(screen.queryByText("Stage 2 Debris")).not.toBeInTheDocument();
    expect(screen.queryByText("Ast. XC7-142")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Deployed Science Controller"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Deployed Science Part")).not.toBeInTheDocument();
    expect(screen.queryByText("Dropped Part")).not.toBeInTheDocument();
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
    // Two vessels are not linked (1 none + 1 unknown: the orbiter and the
    // unresolved contact) out of five.
    expect(visibleText()).toContain("2 Not Linked");
    expect(
      screen.getByRole("meter", { name: "Comms coverage" }),
    ).toHaveAttribute("aria-valuenow", "60");
    expect(visibleText()).toMatch(/3 linked/);
    expect(visibleText()).toMatch(/1 no link/);
    expect(visibleText()).toMatch(/1 unknown/);
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
