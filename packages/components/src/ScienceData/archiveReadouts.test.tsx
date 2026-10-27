import {
  ContributionsProvider,
  clearContributions,
  DashboardItemContext,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";

const META = {
  componentId: "science-data",
  contributionSlots: ["science-data.archive-readouts"] as const,
};

// Cleared before each rather than after, so no mounted tree is notified outside act.
beforeEach(() => {
  clearContributions();
});

async function openArchive() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <DashboardItemContext.Provider value={{ instanceId: "sci-readouts" }}>
            <ScienceDataComponent config={{}} id="sci-readouts" w={8} h={10} />
          </DashboardItemContext.Provider>
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("science.archive", [
      {
        subjectId: "crewReport@KerbinSrfLandedKSC",
        experimentId: "crewReport",
        experimentTitle: "Crew Report",
        body: "Kerbin",
        situation: "SrfLanded",
        biome: "KSC",
        title: "Crew Report from KSC",
        science: 5,
        scienceCap: 5,
        remainingPotential: 0,
        subjectValue: 1,
      },
    ]);
  });
  await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
  await waitFor(() =>
    expect(
      screen.getByRole("rowheader", { name: "Kerbin · Crew Report" }),
    ).toBeInTheDocument(),
  );
}

describe("ScienceData: archive readouts slot", () => {
  it("draws a contributed figure above the Archive table", async () => {
    registerContribution({
      id: "test-transmitted",
      contributes: "science-data.archive-readouts",
      compute: () => [
        {
          id: "transmitted",
          label: "Transmitted",
          value: value("science", 42.5),
        },
      ],
    });
    await openArchive();
    expect(screen.getByText("Transmitted")).toBeInTheDocument();
    expect(visibleText()).toContain("42.5");
  });

  it("draws nothing extra when no Uplink contributes", async () => {
    await openArchive();
    expect(screen.queryByText("Transmitted")).toBeNull();
  });
});
