import { DashboardItemContext, registerAugment } from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { FleetRosterComponent } from "../FleetRoster";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * Composition proof: the reliability augment, bound into the REAL FleetRoster
 * via the fleet-roster.updates slot, surfaces a failing part on the ACTIVE
 * vessel's row ONLY (matching vessel.identity.vesselId) and nothing on the
 * other rows: the active-vessel scope holding in situ, not just in isolation.
 */
const BODIES = { bodies: [{ index: 0, name: "Kerbin" }] };

const FLEET = {
  vessels: [
    {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      bodyIndex: 0,
      crewCount: 1,
      crewCapacity: 1,
      commsControlSource: RosterCommsControlSource.Full,
    },
    {
      vesselId: "v-other",
      name: "Other Craft",
      vesselType: 0,
      situation: 3,
      bodyIndex: 0,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
    },
  ],
};

const CARRIED = [
  "system.vessels",
  "system.bodies",
  "vessel.identity",
  "reliability.summary",
  "reliability.parts",
];

describe("reliability augment composed into FleetRoster", () => {
  it("shows the failing part on the active vessel's row only", async () => {
    registerAugment({
      id: "fleet-reliability-updates",
      augments: "fleet-roster.updates",
      component: FleetReliabilityUpdates,
      channels: ["reliability.summary", "reliability.parts", "vessel.identity"],
    });

    const fixture = setupStreamFixture({ carriedChannels: CARRIED });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
          <FleetRosterComponent config={{}} id="fleet-test" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // First the fleet, so the rows (and their per-row augment slots) mount and
    // the augment actually subscribes...
    act(() => {
      fixture.emit("system.bodies", BODIES);
      fixture.emit("system.vessels", FLEET);
    });
    // ...await the rows so the per-row augments are mounted + subscribed
    // (StubTransport is subscription-gated and does not replay; the real mod
    // re-emits periodically, so a late subscriber gets it on the next tick).
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect(screen.getByText("Other Craft")).toBeInTheDocument();
    // ...then the reliability stream, which the now-subscribed augments receive.
    act(() => {
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Active Craft",
        vesselType: 0,
        situation: 3,
      });
      fixture.emit("reliability.summary", {
        source: "testflight",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", [
        {
          partId: "101:0",
          title: "Reaction Wheel",
          condition: "failed-critical",
          conditionDetail: "busted",
        },
      ]);
    });

    // The failing part + marker appear exactly once, on the active row only.
    expect(await screen.findByText("Reaction Wheel")).toBeInTheDocument();
    expect(screen.getAllByText("Reaction Wheel")).toHaveLength(1);
    expect(screen.getAllByText("1 at risk")).toHaveLength(1);
  });
});
