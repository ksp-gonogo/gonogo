import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  CatalogContact,
  CatalogCrew,
  CatalogEnd,
  RosterCommsControlSource,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VesselCatalogComponent } from "./index";

/** A craft's crew is heard only over a link, so a row says when the crew it shows is no longer known. */

function craft(
  crew: CatalogCrew,
  contact: CatalogContact,
): Record<string, unknown> {
  return {
    vesselId: "v-crewed",
    name: "Duna Lander Bravo",
    vesselType: 2,
    situation: 0,
    bodyIndex: 0,
    crewCount: 2,
    crewCapacity: 3,
    commsConnected: contact === CatalogContact.InContact,
    commsControlSource: RosterCommsControlSource.Partial,
    contact,
    crew,
  };
}

function mount(entry: Record<string, unknown>) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "crew-test" }}>
        <VesselCatalogComponent config={{}} id="crew-test" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [{ index: 0, name: "Duna" }],
    });
    fixture.emit("trackingStation.catalog", { entries: [entry] });
  });
  return view;
}

describe("VesselCatalog: what a centre knows of a craft's crew", () => {
  it("shows a crew it is in contact with as it is", async () => {
    mount(craft(CatalogCrew.Known, CatalogContact.InContact));

    expect(await screen.findByText("2/3")).toBeInTheDocument();
    expect(screen.queryByText(/as last heard/)).toBeNull();
  });

  it("marks a crew it has lost contact with as last heard", async () => {
    const { container } = mount(
      craft(CatalogCrew.Unknown, CatalogContact.Silent),
    );

    await waitFor(() =>
      expect(
        container.querySelector('[data-crew-known="unknown"]'),
      ).toHaveTextContent("2/3"),
    );
    expect(screen.getByText(/as last heard/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("marks the crew of a craft declared lost as presumed lost", async () => {
    const { container } = mount(
      craft(CatalogCrew.PresumedLost, CatalogContact.Lost),
    );

    await waitFor(() =>
      expect(
        container.querySelector('[data-crew-known="presumed-lost"]'),
      ).toHaveTextContent("2/3"),
    );
    expect(screen.getByText(/presumed lost/)).toBeInTheDocument();
  });

  it("marks the crew of a craft heard destroyed as lost", async () => {
    const { container } = mount(craft(CatalogCrew.Lost, CatalogContact.Gone));

    await waitFor(() =>
      expect(
        container.querySelector('[data-crew-known="lost"]'),
      ).toHaveTextContent("2/3"),
    );
    expect(screen.getByText(/crew lost/)).toBeInTheDocument();
  });

  describe("a craft the player ended from the Tracking Station", () => {
    function terminated(crewDead: number | null, crewMissing: number | null) {
      return {
        ...craft(CatalogCrew.Lost, CatalogContact.Gone),
        endKind: CatalogEnd.Terminated,
        crewDead,
        crewMissing,
      };
    }

    it("words its crew from the roster as missing", async () => {
      const { container } = mount(terminated(0, 2));

      await waitFor(() =>
        expect(
          container.querySelector('[data-crew-known="terminated"]'),
        ).toHaveTextContent("2 missing"),
      );
      expect(screen.queryByText(/crew lost/)).toBeNull();
      await expectNoA11yViolations(container);
    });

    it("words a mixed outcome as dead and missing", async () => {
      const { container } = mount(terminated(1, 1));

      await waitFor(() =>
        expect(
          container.querySelector('[data-crew-known="terminated"]'),
        ).toHaveTextContent("1 dead · 1 missing"),
      );
    });

    it("keeps the lost wording when the roster was not read", async () => {
      const { container } = mount(terminated(null, null));

      await waitFor(() =>
        expect(
          container.querySelector('[data-crew-known="lost"]'),
        ).toHaveTextContent("2/3"),
      );
    });

    it("leaves a destroyed craft's crew worded as lost", async () => {
      const { container } = mount({
        ...terminated(0, 2),
        endKind: CatalogEnd.Destroyed,
      });

      await waitFor(() =>
        expect(
          container.querySelector('[data-crew-known="lost"]'),
        ).toHaveTextContent("2/3"),
      );
      expect(
        container.querySelector('[data-crew-known="terminated"]'),
      ).toBeNull();
    });
  });
});
