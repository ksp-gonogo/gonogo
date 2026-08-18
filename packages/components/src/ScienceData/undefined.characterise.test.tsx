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
 * CHARACTERISATION. What Science Data does TODAY when its telemetry reads are
 * `undefined`, ahead of the `Reading<T>` migration. Not what it should do.
 *
 * This widget gives `undefined` at least four meanings:
 *
 *   - `science.archive` absent means SANDBOX MODE: the Archive tab states, as a
 *     fact, that this save has no R&D instance
 *   - `science.experiments` / `science.experimentBreakdown` absent means "no
 *     science aboard", via `parseX(undefined) === null` and then a length check
 *   - `spaceCenter.scene` / `career.mode` absent (through `useGameContext`) mean
 *     NO GAME SIGNAL, which leaves the vessel-scoped Aboard tab enabled and
 *     hides the banked-science readout
 *   - `vessel.surface` absent collapses to an empty locale string, which the
 *     situation line then omits rather than marking as unknown
 *
 * Every one of those is a falsy-check on a read that becomes a truthy `Reading`.
 */

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

const CARRIED = [
  ...VESSEL_STATE_INPUTS,
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

/** Emit and open the next frame together: the store only re-samples on a frame. */
function feed(fixture: StreamFixture, topic: string, payload: unknown): void {
  act(() => {
    fixture.emit(topic, payload);
    fixture.store.beginFrame();
  });
}

/** vessel.state's derived inputs, minus `vessel.surface`, so body and situation resolve while the locale stays absent. */
function feedSituation(fixture: StreamFixture): void {
  act(() => {
    fixture.emit("vessel.orbit", {
      sma: 682500,
      ecc: 0,
      inc: 0,
      argPe: 0,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      referenceBodyIndex: 2,
    });
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
    // `body && situation` both undefined: the line names the absence rather
    // than rendering a half-joined "undefined · undefined".
    expect(
      screen.getByText("Awaiting situation telemetry"),
    ).toBeInTheDocument();
    // `parseExperimentBreakdown(undefined)` and `parseExperiments(undefined)`
    // are both null, so `hasBreakdown`/`hasExperiments` are false and neither
    // table renders. Named assertions, not an empty-container one.
    expect(screen.getByText("No science data aboard.")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Subject" }),
    ).not.toBeInTheDocument();
    // The filter control is gated on the same two flags, so an operator gets no
    // search box to type into over an absent list.
    expect(
      screen.queryByPlaceholderText("Filter subjects…"),
    ).not.toBeInTheDocument();
  });

  it("renders no record-count line at all, where an empty list would say 0 records", () => {
    const fixture = renderData();
    // `sciCount = experiments ? experiments.length : undefined`, and the line is
    // gated on `typeof sciCount === "number"`: the absent read prints nothing.
    expect(screen.queryByText(/record/)).not.toBeInTheDocument();

    feed(fixture, "science.experiments", []);
    // The contrast that makes the gate visible: a CONFIRMED empty list is a
    // zero, and gets said out loud.
    expect(screen.getByText(/0 records/)).toBeInTheDocument();
    expect(screen.getByText("No science data aboard.")).toBeInTheDocument();
  });

  it("leaves the vessel-scoped Aboard tab selectable, because absent scene telemetry reads as no game signal", () => {
    renderData();
    const aboard = screen.getByRole("tab", { name: "Aboard" });
    // `noVessel = hasGameSignal && !inFlight`, and `hasGameSignal` is false when
    // both `spaceCenter.scene` and `career.mode` are absent. So with no
    // telemetry whatsoever the widget behaves as though a vessel were flying:
    // Aboard stays enabled and selected rather than falling through to Archive.
    expect(aboard).toHaveAttribute("aria-selected", "true");
    expect(aboard).not.toBeDisabled();
  });

  it("hides the banked-science readout when career.mode is absent, even with a science figure in hand", () => {
    const fixture = renderData();
    feed(fixture, "career.status", { economy: { science: 1234 } });
    // `isCareerLike` comes from `career.mode`, which is absent, so the figure
    // that DID arrive is suppressed. Absence of the mode is read as "not a
    // career", the same answer a real sandbox save produces.
    expect(screen.queryByText(/1234 SCI/)).not.toBeInTheDocument();

    feed(fixture, "career.mode", { mode: 1 });
    // The mode arriving is the only thing that changed, which is what stops the
    // assertion above from passing for some unrelated reason.
    expect(screen.getByText(/1234 SCI/)).toBeInTheDocument();
  });
});

describe("ScienceData's Archive tab reads an absent archive as Sandbox mode", () => {
  it("states there is no R&D archive in this save when nothing has arrived", async () => {
    renderData();
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    // The confident claim from a never-arrived read: `parseArchive(undefined)`
    // is null, and null is spelled "Sandbox" here. A cold topic and a genuine
    // sandbox save are indistinguishable on screen.
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
    // `parseArchive` names both cases in one condition
    // (`raw === null || raw === undefined`), so this widget DOES look at the
    // difference and deliberately collapses it: a confirmed "there is no
    // archive" and "nothing has arrived yet" both render the sandbox sentence.
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
    // The one case the widget reports honestly today, and the reason the two
    // above are worth pinning: an empty array is a fresh career, not a sandbox.
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
    // `liveBiome ?? landedAt ?? ""` collapses both absent surface fields to an
    // empty string, and the `situationLocale ? …` gate then drops the segment
    // entirely: the line reads as though the biome were not part of it, rather
    // than marking it unknown.
    expect(screen.getByText("Mun · Landed")).toBeInTheDocument();
  });

  it("renders an experiment row whose dataAmount field is undefined, with the figure nulled out", () => {
    const fixture = renderData();
    feed(fixture, "science.experiments", [
      { subjectId: "crewReport@KerbinSrfLandedKSC", title: "Crew Report" },
    ]);
    // The record ARRIVED; only the field is absent. `parseExperiments` maps it
    // to `dataAmount: null` and the column renders the null glyph, so the row
    // itself still lists. Contrast the whole-topic absence above, which renders
    // no table at all.
    expect(screen.getByText("Crew Report")).toBeInTheDocument();
    expect(visibleText()).toContain(NULL_DISPLAY);
    // No figure anywhere means the "· N collected" summand is dropped too: only
    // entries carrying a figure are summed, and none do.
    expect(screen.getByText(/1 record/)).toBeInTheDocument();
    expect(visibleText()).not.toContain("collected");

    feed(fixture, "science.experiments", [
      {
        subjectId: "crewReport@KerbinSrfLandedKSC",
        title: "Crew Report",
        dataAmount: 5,
      },
    ]);
    // With a figure present the summand appears, so the absence above is the
    // gate firing rather than the line never existing.
    expect(visibleText()).toContain("collected");
  });

  it("titles an experiment whose title field is undefined as (unnamed)", () => {
    const fixture = renderData();
    feed(fixture, "science.experiments", [
      { subjectId: "mysteryGoo@MunSrfLandedMidlands", dataAmount: 8 },
    ]);
    // Same partial-payload family: the absent field is filled with a literal
    // rather than dropping the row.
    expect(screen.getByText("(unnamed)")).toBeInTheDocument();
  });
});
