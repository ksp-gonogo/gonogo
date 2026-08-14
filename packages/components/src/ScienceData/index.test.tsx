import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import {
  type ArchiveSubject,
  groupArchiveByExperiment,
  parseArchive,
  parseExperimentBreakdown,
  parseExperiments,
  ScienceDataComponent,
} from "./index";

// vessel.state's declared derived inputs: body/situation route off the
// derived vessel.state channel (parentBodyName from vessel.identity +
// system.bodies; situationName from vessel.identity.situation).
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

const renderedTrees: Array<() => void> = [];

function newFixture(): StreamFixture {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
}

function renderData(fixture: StreamFixture, w = 8, h = 10) {
  const result = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci" }}>
        <ScienceDataComponent config={{}} id="sci" w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/** Emits vessel.state's inputs so parentBodyName/situationName resolve. */
function emitSituation(
  fixture: StreamFixture,
  { situation, landedAt }: { situation: number; landedAt: string },
) {
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
    situation,
    launchUt: 0,
  });
  fixture.emit("vessel.surface", { landedAt });
}

describe("ScienceDataComponent", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
  });

  it("renders the Aboard tab selected by default", () => {
    renderData(newFixture());
    expect(screen.getByRole("tab", { name: "Aboard" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Archive" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("shows the awaiting placeholder before any situation telemetry", () => {
    renderData(newFixture());
    expect(
      screen.getByText(/Awaiting situation telemetry/i),
    ).toBeInTheDocument();
  });

  it("joins body, situation and biome with a middle dot on the situation line", async () => {
    const fixture = newFixture();
    renderData(fixture);
    act(() => {
      emitSituation(fixture, { situation: 0, landedAt: "Northwest Crater" });
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Mun · Landed · Northwest Crater/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the banked-science readout in career mode and hides it in sandbox", async () => {
    const career = newFixture();
    renderData(career);
    act(() => {
      career.emit("career.mode", { mode: 1 });
      career.emit("career.status", { economy: { science: 1234 } });
    });
    await waitFor(() =>
      expect(screen.getByText(/1234 SCI/)).toBeInTheDocument(),
    );

    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;

    const sandbox = newFixture();
    renderData(sandbox);
    act(() => {
      sandbox.emit("career.mode", { mode: 0 });
      sandbox.emit("career.status", { economy: { science: 42 } });
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Aboard" })).toBeInTheDocument(),
    );
    // Sandbox banks no career science, the "<n> SCI" readout is suppressed.
    expect(screen.queryByText(/42 SCI/)).not.toBeInTheDocument();
  });

  it("lists the Aboard breakdown rows with data and remaining potential", async () => {
    const fixture = newFixture();
    renderData(fixture);
    act(() => {
      fixture.emit("science.experimentBreakdown", [
        {
          subjectId: "mysteryGoo@MunSrfLandedMidlands",
          biome: "Midlands",
          situation: "SrfLanded",
          expTitle: "Mystery Goo Observation",
          dataMits: 8,
          remainingPotential: 12.5,
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText(/Mystery Goo Observation/)).toBeInTheDocument(),
    );
    // Read through the kit's helper rather than getByText: `<Unit>` renders
    // the number, the symbol and the spoken word as separate elements, so a
    // readout is not one text node.
    expect(visibleText()).toContain("8.0 mits");
    expect(visibleText()).toContain("12.5 left");
  });

  it("renders the science-data.aboard-row slot empty on the stock path (no Kerbalism augment imported)", async () => {
    const fixture = newFixture();
    renderData(fixture);
    act(() => {
      fixture.emit("science.experimentBreakdown", [
        {
          subjectId: "mysteryGoo@MunSrfLandedMidlands",
          biome: "Midlands",
          situation: "SrfLanded",
          expTitle: "Mystery Goo Observation",
          dataMits: 8,
          remainingPotential: 12.5,
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText(/Mystery Goo Observation/)).toBeInTheDocument(),
    );
    // No Kerbalism Uplink client is imported anywhere in this package's test
    // tree, so the slot has nothing bound: the row renders exactly as it
    // did before the slot existed, no Send/Delete/Analyze/Dump control.
    expect(
      screen.queryByRole("button", { name: /send|delete|analyze|dump/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the plain experiments list when no breakdown is present", async () => {
    const fixture = newFixture();
    renderData(fixture);
    act(() => {
      fixture.emit("science.experiments", [
        {
          subjectId: "crewReport@KerbinSrfLandedKSC",
          title: "Crew Report",
          dataAmount: 5,
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText("Crew Report")).toBeInTheDocument(),
    );
    expect(visibleText()).toContain("5.0 mits");
  });

  it("shows the sandbox message on the Archive tab when there is no R&D archive", async () => {
    const fixture = newFixture();
    renderData(fixture);
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    // Nothing emitted onto science.archive: the read stays undefined, which
    // parseArchive maps to null (no R&D instance, i.e. Sandbox).
    await waitFor(() =>
      expect(
        screen.getByText(/No R&D archive in this save/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the empty-career message when the archive is present but empty", async () => {
    const fixture = newFixture();
    renderData(fixture);
    act(() => {
      fixture.emit("science.archive", []);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    await waitFor(() =>
      expect(
        screen.getByText(/No science collected yet this career/i),
      ).toBeInTheDocument(),
    );
  });

  it("groups the archive by body then experiment on the Archive tab", async () => {
    const fixture = newFixture();
    renderData(fixture, 12, 14);
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
        {
          subjectId: "mysteryGoo@MunSrfLandedMidlands",
          experimentId: "mysteryGoo",
          experimentTitle: "Mystery Goo Observation",
          body: "Mun",
          situation: "SrfLanded",
          biome: "Midlands",
          title: "Mystery Goo from Mun",
          science: 6,
          scienceCap: 15,
          remainingPotential: 9,
          subjectValue: 1.5,
        },
      ]);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Archive" }));
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText("Crew Report")).toBeInTheDocument();
    expect(screen.getByText("Mystery Goo Observation")).toBeInTheDocument();
    // Kerbin crew report is capped out: renders "complete", not "left".
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText(/9\.0 left/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const { container } = renderData(fixture);
    act(() => {
      emitSituation(fixture, { situation: 0, landedAt: "Highlands" });
      fixture.emit("science.archive", []);
    });
    let results: Awaited<ReturnType<typeof axe>> | undefined;
    await act(async () => {
      results = await axe(container);
    });
    expect(results).toHaveNoViolations();
  });
});

describe("parseExperiments", () => {
  it("reads partName or part and pulls the magnitude off a unit-wrapped dataAmount", () => {
    const parsed = parseExperiments([
      {
        subjectId: "a",
        title: "A",
        partName: "Goo",
        dataAmount: { magnitude: 3, unit: "Mit" },
      },
      { subjectId: "b", title: "B", part: "Thermometer", dataAmount: 2 },
    ]);
    expect(parsed).toEqual([
      { subjectId: "a", title: "A", part: "Goo", dataAmount: 3 },
      { subjectId: "b", title: "B", part: "Thermometer", dataAmount: 2 },
    ]);
  });

  it("returns null for a non-array", () => {
    expect(parseExperiments(undefined)).toBeNull();
    expect(parseExperiments("nope")).toBeNull();
  });
});

describe("parseExperimentBreakdown", () => {
  it("sorts by remaining potential desc and reads wrapped magnitudes", () => {
    const parsed = parseExperimentBreakdown([
      { subjectId: "low", expTitle: "Low", dataMits: 1, remainingPotential: 2 },
      {
        subjectId: "high",
        expTitle: "High",
        dataMits: 1,
        remainingPotential: 9,
      },
    ]);
    expect(parsed?.map((e) => e.subjectId)).toEqual(["high", "low"]);
  });
});

describe("parseArchive", () => {
  it("distinguishes a null (Sandbox) archive from an empty (fresh career) one", () => {
    expect(parseArchive(null)).toBeNull();
    expect(parseArchive(undefined)).toBeNull();
    expect(parseArchive([])).toEqual([]);
  });

  it("reads the unit-wrapped science figures via magnitude", () => {
    const parsed = parseArchive([
      {
        subjectId: "s",
        experimentId: "crewReport",
        body: "Kerbin",
        science: { magnitude: 5, unit: "science" },
        scienceCap: { magnitude: 8, unit: "science" },
        remainingPotential: { magnitude: 3, unit: "science" },
        subjectValue: 1,
      },
    ]);
    expect(parsed?.[0].science).toBe(5);
    expect(parsed?.[0].remainingPotential).toBe(3);
  });
});

describe("groupArchiveByExperiment", () => {
  it("groups by body then experiment, preferring experimentId over the subjectId split", () => {
    const entries: ArchiveSubject[] = [
      {
        subjectId: "crewReport@KerbinFlyingHighKSC",
        experimentId: "crewReport",
        experimentTitle: "Crew Report",
        body: "Kerbin",
        situation: "FlyingHigh",
        biome: "KSC",
        title: "t",
        science: 1,
        scienceCap: 2,
        remainingPotential: 1,
        subjectValue: 1,
      },
      {
        subjectId: "mysteryGoo@MunSrfLandedMidlands",
        experimentId: "mysteryGoo",
        experimentTitle: "Mystery Goo",
        body: "Mun",
        situation: "SrfLanded",
        biome: "Midlands",
        title: "t",
        science: 1,
        scienceCap: 5,
        remainingPotential: 4,
        subjectValue: 1,
      },
    ];
    const groups = groupArchiveByExperiment(entries);
    expect(groups.map((g) => g.body).sort()).toEqual(["Kerbin", "Mun"]);
    const kerbin = groups.find((g) => g.body === "Kerbin");
    expect(kerbin?.experiments[0].expId).toBe("crewReport");
    expect(kerbin?.experiments[0].expTitle).toBe("Crew Report");
  });
});
