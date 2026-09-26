import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";

/**
 * Characterisation: pins what Science Data does today when its reads are `undefined`, not what it should do.
 * An absent archive reads as Sandbox, absent ledgers as nothing aboard, absent scene and mode as no game signal, and an absent surface drops the locale.
 */

const CARRIED = [
  "vessel.identity",
  "system.bodies",
  "vessel.surface",
  "science.experiments",
  "science.experimentBreakdown",
  "science.archive",
  "career.status",
  "career.mode",
] as const;

const trees: Array<() => void> = [];

function renderData(w = 8) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci" }}>
        <ScienceDataComponent config={{}} id="sci" w={w} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  trees.push(unmount);
  return fixture;
}

/** The store only re-samples on a frame, so emit and open the next one together. */
function feed(fixture: StreamFixture, topic: string, payload: unknown): void {
  act(() => {
    fixture.emit(topic, payload);
    fixture.store.beginFrame();
  });
}

/** The identity and roster, and no `vessel.surface`, so body and situation resolve while the locale stays absent. */
function feedSituation(fixture: StreamFixture): void {
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [
        { name: "Mun", index: 2, parentIndex: 0, radius: 200_000, orbit: null },
      ],
    });
    fixture.emit("vessel.identity", {
      parentBodyIndex: 2,
      situation: 0,
      launchUt: 0,
    });
    fixture.store.beginFrame();
  });
}

afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
});

describe("ScienceData with nothing on the stream", () => {
  it("renders the Aboard tab with the awaiting line, the no-data state, and no table", () => {
    renderData();
    expect(screen.getByText("SCIENCE DATA")).toBeInTheDocument();
    expect(
      screen.getByText("Awaiting situation telemetry"),
    ).toBeInTheDocument();
    expect(screen.getByText("No science data aboard.")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Subject" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Filter subjects..."),
    ).not.toBeInTheDocument();
  });

  it("renders no record-count line at all, where an empty list would say 0 records", () => {
    const fixture = renderData();
    expect(screen.queryByText(/record/)).not.toBeInTheDocument();

    feed(fixture, "science.experiments", []);
    // The contrast: a confirmed empty list is a zero, and says so.
    expect(screen.getByText(/0 records/)).toBeInTheDocument();
    expect(screen.getByText("No science data aboard.")).toBeInTheDocument();
  });

  it("leaves the vessel-scoped Aboard tab selectable, because absent scene telemetry reads as no game signal", () => {
    renderData();
    const aboard = screen.getByRole("tab", { name: "Aboard" });
    // With no game signal at all the widget behaves as though a vessel were flying.
    expect(aboard).toHaveAttribute("aria-selected", "true");
    expect(aboard).not.toBeDisabled();
  });

  it("hides the banked-science readout when career.mode is absent, even with a science figure in hand", () => {
    const fixture = renderData();
    feed(fixture, "career.status", { economy: { science: 1234 } });
    // An absent `career.mode` reads as "not a career", suppressing a figure that did arrive.
    expect(screen.queryByText(/1234 SCI/)).not.toBeInTheDocument();

    feed(fixture, "career.mode", { mode: 1 });
    // The only change is the mode arriving, so the assertion above is not passing for some other reason.
    expect(screen.getByText(/1234 SCI/)).toBeInTheDocument();
  });
});

describe("ScienceData's Archive tab reads an absent archive as Sandbox mode", () => {
  it("states there is no R&D archive in this save when nothing has arrived", async () => {
    renderData();
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    // A cold topic and a genuine Sandbox save are indistinguishable on screen.
    expect(
      screen.getByText(
        "No R&D archive in this save, Sandbox mode banks no career science.",
      ),
    ).toBeInTheDocument();
  });

  it("says the same thing for a null tombstone as for a never-arrived read", async () => {
    const fixture = renderData();
    feed(fixture, "science.archive", null);
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    expect(
      screen.getByText(
        "No R&D archive in this save, Sandbox mode banks no career science.",
      ),
    ).toBeInTheDocument();
  });

  it("distinguishes a confirmed empty archive from an absent one", async () => {
    const fixture = renderData();
    feed(fixture, "science.archive", []);
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    // An empty array is a fresh career, not a Sandbox save.
    expect(
      screen.getByText("No science collected yet this career."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No R&D archive in this save/),
    ).not.toBeInTheDocument();
  });
});

describe("ScienceData with a partial payload", () => {
  it("omits the locale from the situation line when vessel.surface never arrives", () => {
    const fixture = renderData();
    feedSituation(fixture);
    // The segment is dropped rather than marked unknown.
    expect(screen.getByText("Mun · Landed")).toBeInTheDocument();
  });

  it("renders an experiment row whose dataAmount field is undefined, with the figure nulled out", () => {
    const fixture = renderData();
    feed(fixture, "science.experiments", [
      { subjectId: "crewReport@KerbinSrfLandedKSC", title: "Crew Report" },
    ]);
    // The record arrived with only the field absent, so the row still lists with the null glyph.
    expect(screen.getByText("Crew Report")).toBeInTheDocument();
    expect(visibleText()).toContain(NULL_DISPLAY);
    // Only entries carrying a figure are summed, and none do.
    expect(screen.getByText(/1 record/)).toBeInTheDocument();
    expect(visibleText()).not.toContain("collected");

    feed(fixture, "science.experiments", [
      {
        subjectId: "crewReport@KerbinSrfLandedKSC",
        title: "Crew Report",
        dataAmount: 5,
      },
    ]);
    expect(visibleText()).toContain("collected");
  });

  it("titles an experiment whose title field is undefined as (unnamed)", () => {
    const fixture = renderData();
    feed(fixture, "science.experiments", [
      { subjectId: "mysteryGoo@MunSrfLandedMidlands", dataAmount: 8 },
    ]);
    expect(screen.getByText("(unnamed)")).toBeInTheDocument();
  });
});
