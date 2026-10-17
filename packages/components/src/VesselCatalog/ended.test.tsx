import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  CatalogContact,
  CatalogEnd,
  RosterCommsControlSource,
  RosterPlaceSource,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VesselCatalogComponent } from "./index";

/** A destroyed craft stays in the catalog, saying how the centre learned of it, until the player dismisses it. */

function craft(
  vesselId: string,
  name: string,
  ended: RosterPlaceSource | null,
  endKind: CatalogEnd | null = ended == null ? null : CatalogEnd.Destroyed,
): Record<string, unknown> {
  return {
    vesselId,
    name,
    vesselType: 3,
    situation: 3,
    bodyIndex: 0,
    crewCount: 0,
    crewCapacity: 0,
    commsConnected: true,
    commsControlSource: RosterCommsControlSource.Full,
    contact: ended == null ? CatalogContact.InContact : CatalogContact.Gone,
    endSource: ended,
    endedUt: ended == null ? null : 5,
    endKind,
  };
}

function mount(entries: Record<string, unknown>[]) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ended-test" }}>
        <VesselCatalogComponent config={{}} id="ended-test" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [{ index: 0, name: "Kerbin" }],
    });
    fixture.emit("trackingStation.catalog", { entries });
  });
  return { ...view, fixture };
}

describe("VesselCatalog: a destroyed craft", () => {
  it("says it was destroyed when the centre heard so over a link", async () => {
    const { container } = mount([
      craft("v-probe", "Mun Probe", RosterPlaceSource.Heard),
    ]);

    expect(await screen.findByText("destroyed")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("says it was seen destroyed when the centre saw it go", async () => {
    mount([craft("v-probe", "Mun Probe", RosterPlaceSource.Seen)]);

    expect(await screen.findByText("seen destroyed")).toBeInTheDocument();
  });

  it("says it was terminated when the player ended it from the Tracking Station", async () => {
    mount([
      craft(
        "v-probe",
        "Mun Probe",
        RosterPlaceSource.Heard,
        CatalogEnd.Terminated,
      ),
    ]);

    expect(await screen.findByText("terminated")).toBeInTheDocument();
  });

  it("is not counted in the fleet's links", async () => {
    mount([
      craft("v-relay", "Relay One", null),
      craft("v-probe", "Mun Probe", RosterPlaceSource.Heard),
    ]);

    expect(await screen.findByText("All Linked")).toBeInTheDocument();
  });

  it("sends the dismissal for that craft when the player dismisses it", async () => {
    const user = userEvent.setup();
    const { fixture } = mount([
      craft("v-probe", "Mun Probe", RosterPlaceSource.Heard),
    ]);

    await user.click(
      await screen.findByRole("button", {
        name: "Dismiss Mun Probe from the catalog",
      }),
    );

    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.find(
          (c) => c.command === "trackingStation.catalog.dismiss",
        ),
      ).toMatchObject({ args: { vesselId: "v-probe" } }),
    );
  });

  it("offers no dismissal for a craft still flying", async () => {
    mount([craft("v-relay", "Relay One", null)]);

    await screen.findByText("Relay One");
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
  });
});
