import {
  ContributionsProvider,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  CatalogContact,
  CatalogCrew,
  RosterCommsControlSource,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";
import "./vesselOrbitsContribution";

/** A craft selected on the diagram shows the Vessel Catalog's entry for it in the side bar: its link, its contact and the Uplinks' updates for it. */

const KERBIN_MU = 3.5316e12;

const META = {
  componentId: "tracking-station",
  contributionSlots: ["tracking-station.entities"] as const,
};

function orbit(sma: number) {
  return {
    sma,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
}

function mountScene() {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <TrackingStationComponent config={{ frame: "Kerbin" }} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [
        {
          index: 0,
          name: "Kerbol",
          parentIndex: null,
          radius: 261_600_000,
          gravParameter: 1.1723328e18,
          orbit: null,
        },
        {
          index: 1,
          name: "Kerbin",
          parentIndex: 0,
          radius: 600_000,
          gravParameter: KERBIN_MU,
          sphereOfInfluence: 84_159_286,
          isHome: true,
          orbit: { ...orbit(13_599_840_256), meanAnomalyAtEpoch: 3.14 },
        },
      ],
    });
    fixture.emit("trackingStation.catalog", {
      entries: [
        {
          vesselId: "v-silent",
          name: "Silent Sat",
          vesselType: 6,
          situation: 3,
          bodyIndex: 1,
          crewCount: 2,
          crewCapacity: 3,
          commsControlSource: RosterCommsControlSource.Full,
          contact: CatalogContact.Silent,
          crew: CatalogCrew.Unknown,
          orbit: orbit(1_200_000),
        },
      ],
    });
  });
  return view;
}

async function selectSilentSat(container: HTMLElement) {
  const marker = await waitFor(() => {
    const el = container.querySelector(
      '[data-entity-id="vessel-orbit:v-silent"]',
    );
    expect(el).not.toBeNull();
    return el as SVGGElement;
  });
  fireEvent.click(marker);
  return screen.findByRole("complementary", { name: "Silent Sat" });
}

describe("TrackingStation: the selected craft's catalog entry", () => {
  it("shows the craft's contact and link as the Vessel Catalog does", async () => {
    const { container } = mountScene();
    const sideBar = await selectSilentSat(container);

    expect(within(sideBar).getByText("no contact")).toBeInTheDocument();
    expect(within(sideBar).getByText("DIRECT")).toBeInTheDocument();
    expect(within(sideBar).getByText(/as last heard/)).toBeInTheDocument();
    expect(within(sideBar).getAllByText("Crew")).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it("shows the Uplinks' updates for the craft", async () => {
    registerAugment<"vessel-catalog.updates">({
      id: "test-selected-craft-update",
      augments: "vessel-catalog.updates",
      component: ({ vesselId }) => (
        <span data-testid="craft-update" data-vessel={vesselId} />
      ),
    });
    const { container } = mountScene();
    const sideBar = await selectSilentSat(container);

    expect(
      within(sideBar).getByTestId("craft-update").getAttribute("data-vessel"),
    ).toBe("v-silent");
  });
});
