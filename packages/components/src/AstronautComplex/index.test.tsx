import {
  ContributionsProvider,
  clearActionHandlers,
  clearAugments,
  clearContributions,
  DashboardItemContext,
  dispatchAction,
  registerAugment,
  registerContribution,
} from "@ksp-gonogo/core";
import {
  CommandErrorCode,
  CrewStanding,
  GateOutcome,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations, getByTip } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

// Unmounted before clearActionHandlers(), whose notification on a mounted widget lands outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/** Integration over a real stream: the applicant pool, funds, and the real `career.crew.hire` dispatch, with no hooks mocked. */

/** The mod's standing verdict on `career.crew.hire`, as `system.uplink.gates` carries it. */
function emitHireGate(
  fixture: StreamFixture,
  errorCode: CommandErrorCode,
  detail: string,
) {
  fixture.emit("system.uplink.gates", {
    gates: [
      {
        command: "career.crew.hire",
        verdict: { outcome: GateOutcome.Fail, errorCode, detail },
      },
    ],
  });
}

// Generous, so affordability blocks a hire only when a test lowers it.
function emitFunds(fixture: StreamFixture, funds: number | null) {
  fixture.emit("career.status", { balances: { funds } });
}

function emitCrewRoster(
  fixture: StreamFixture,
  crew: Array<{
    name: string;
    trait: string;
    /** Optional so a test can send a row the producer had no rank for. */
    experienceLevel?: number;
    situation: string;
    standing?: number;
    situationOrdinal?: number;
    inactive?: boolean;
    inactiveUntilUt?: number;
    standingEndsAtUt?: number;
    isApplicant?: boolean;
    available?: boolean;
    unavailableReason?: string;
    courage?: number;
    stupidity?: number;
    experienceLevelDelta?: number;
    roleDescription?: string;
    descriptionEffects?: string;
  }>,
) {
  fixture.emit("spaceCenter.crewRoster", crew);
}

function emitComplex(
  fixture: StreamFixture,
  complex: {
    applicants: Array<{
      name: string;
      trait: string;
      experienceLevel?: number;
      courage?: number;
      stupidity?: number;
      roleDescription?: string;
      descriptionEffects?: string;
    }>;
    activeCrew: number;
    crewCapacity: number;
    nextHireCost: number;
  },
) {
  fixture.emit("spaceCenter.astronautComplex", complex);
}

const APPLICANTS = [
  {
    name: "Desdin Kerman",
    trait: "Scientist",
    experienceLevel: 0,
    courage: 0.65,
    stupidity: 0.2,
    roleDescription:
      "Scientists can analyze certain science experiments in the field, doubling the science recovered, and can restore science experiments after use.",
    descriptionEffects: "Level 0: Can analyze Mystery Goo and Materials Bay.",
  },
  {
    // No roleDescription/descriptionEffects: the popover's empty state, tested below.
    name: "Limmy Kerman",
    trait: "Pilot",
    experienceLevel: 0,
    courage: 0.4,
    stupidity: 0.55,
  },
];
const NEXT_HIRE_COST = 24000;
// KSP's int.MaxValue: GetActiveCrewLimit's unlimited roster.
const UNLIMITED_CREW_CAP = 2_147_483_647;

/* Spans four standings, so the Active tab must derive its sub-tabs. */
const CREW_ROSTER = [
  {
    name: "Bill Kerman",
    trait: "Engineer",
    experienceLevel: 2,
    situation: "Available",
    standing: CrewStanding.Available,
    situationOrdinal: 0,
    available: true,
    unavailableReason: "",
    courage: 0.5,
    stupidity: 0.3,
    experienceLevelDelta: 0.4,
    roleDescription:
      "Engineers can repair the wheels and landing gear of a vessel, as well as fixing parts that have broken due to fatigue.",
    descriptionEffects:
      "Level 2: Can repair broken parts and fix wheels/landing gear.",
  },
  {
    name: "Jeb Kerman",
    trait: "Pilot",
    experienceLevel: 3,
    situation: "Assigned",
    standing: CrewStanding.Assigned,
    situationOrdinal: 1,
    available: false,
    unavailableReason: "On mission",
    courage: 0.9,
    stupidity: 0.1,
    experienceLevelDelta: 0.2,
  },
  {
    name: "Val Kerman",
    trait: "Pilot",
    experienceLevel: 1,
    situation: "Dead",
    standing: CrewStanding.Dead,
    situationOrdinal: 2,
    available: false,
    unavailableReason: "Dead",
    courage: 0.6,
    stupidity: 0.2,
    experienceLevelDelta: 0.6,
  },
  {
    name: "Bob Kerman",
    trait: "Scientist",
    experienceLevel: 5,
    situation: "Missing",
    standing: CrewStanding.Missing,
    situationOrdinal: 3,
    available: false,
    unavailableReason: "Missing",
    courage: 0.7,
    stupidity: 0.25,
    experienceLevelDelta: 1,
  },
];

describe("AstronautComplexComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    unmountAll();
    clearActionHandlers();
    clearAugments();
    clearContributions();
  });

  function renderWidget(id = "astronaut-complex") {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <AstronautComplexComponent config={{}} id={id} w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  /** The widget inside a contribution store, which the core-stat contribution tests need. */
  function renderWidgetWithContributions(id = "astronaut-complex") {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <WidgetMetaContext.Provider
            value={{
              componentId: "astronaut-complex",
              contributionSlots: ["astronaut-complex.readouts"],
            }}
          >
            <ContributionsProvider>
              <AstronautComplexComponent config={{}} id={id} w={6} h={8} />
            </ContributionsProvider>
          </WidgetMetaContext.Provider>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  it("renders the panel and a waiting-for-telemetry empty state before telemetry", () => {
    // Before anything arrives the widget says it is waiting; "career mode only" is reserved for a confirmed absence.
    renderWidget();
    expect(screen.getByText(/ASTRONAUT COMPLEX/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for telemetry/i)).toBeInTheDocument();
    expect(screen.queryByText(/career mode only/i)).not.toBeInTheDocument();
  });

  it("shows the header (funds, next-hire cost, active/max crew) and the Applicants tab by default", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    // The applicant pool is the only element unique to the post-emission render.
    await screen.findByText("Desdin Kerman");
    // The funds readout is in-widget, beside the spend control.
    expect(screen.getByText("Funds")).toBeInTheDocument();
    expect(screen.getByText("Next Hire")).toBeInTheDocument();
    expect(screen.getByText("Active Kerbals")).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 13/)).toBeInTheDocument();

    const applicantsTab = screen.getByRole("tab", { name: "Applicants" });
    expect(applicantsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Active" })).toBeInTheDocument();

    expect(screen.getByText("Desdin Kerman")).toBeInTheDocument();
    expect(screen.getByText("Limmy Kerman")).toBeInTheDocument();
  });

  it("shows courage and stupidity per applicant, and withholds rank", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    await screen.findByText("Desdin Kerman");
    const row = screen.getByText("Desdin Kerman").closest("li") as HTMLElement;
    expect(getByTip(row, /Courage: 65 percent/)).toBeInTheDocument();
    expect(getByTip(row, /Stupidity: 20 percent/)).toBeInTheDocument();
    expect(within(row).queryByText(/^L\d/)).not.toBeInTheDocument();
  });

  it("shows a sensible empty state on the Active tab when no crew roster has landed", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");

    await user.click(screen.getByRole("tab", { name: "Active" }));
    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Desdin Kerman")).not.toBeInTheDocument();
    expect(screen.getByText(/no active crew/i)).toBeInTheDocument();
  });

  it("derives one Active sub-tab per CrewStanding present, with per-tab counts and no hardcoded fold", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await screen.findByText("Desdin Kerman");

    await user.click(screen.getByRole("tab", { name: "Active" }));

    // Dead and Missing each get their own tab.
    for (const [standing, count] of [
      ["Available", 1],
      ["Assigned", 1],
      ["Dead", 1],
      ["Missing", 1],
    ] as const) {
      expect(
        screen.getByRole("tab", { name: `${standing} (${count})` }),
      ).toBeInTheDocument();
    }
    // No "Lost" fold tab.
    expect(
      screen.queryByRole("tab", { name: /lost/i }),
    ).not.toBeInTheDocument();

    // The first tab (Available) is active by default, rank included, unlike Applicants.
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    const row = screen.getByText("Bill Kerman").closest("li") as HTMLElement;
    expect(within(row).getByText("L2")).toBeInTheDocument();
    expect(getByTip(row, /Courage: 50 percent/)).toBeInTheDocument();
    expect(
      getByTip(row, /Experience toward next rank: 40 percent/),
    ).toBeInTheDocument();

    // Sub-tabs swap the visible slice of the ONE underlying list.
    await user.click(screen.getByRole("tab", { name: "Dead (1)" }));
    expect(screen.getByText("Val Kerman")).toBeInTheDocument();
    expect(screen.queryByText("Bill Kerman")).not.toBeInTheDocument();
  });

  it("gives a maxed-rank kerbal a MAX chip instead of a redundant 100%", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await user.click(await screen.findByRole("tab", { name: "Missing (1)" }));

    const row = (await screen.findByText("Bob Kerman")).closest(
      "li",
    ) as HTMLElement;
    expect(within(row).getByText("MAX")).toBeInTheDocument();
  });

  /** A rank, courage or stupidity that never arrived must not read as a real score: `L0` is a rookie every save has. */
  it("says a rank, a courage and a stupidity it was never sent are missing, rather than passing them off as zero", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          name: "Nedcas Kerman",
          trait: "Engineer",
          situation: "Available",
          standing: CrewStanding.Available,
          situationOrdinal: 0,
          available: true,
          unavailableReason: "",
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    const row = (await screen.findByText("Nedcas Kerman")).closest(
      "li",
    ) as HTMLElement;
    expect(
      within(row).queryByLabelText("Experience level 0"),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByLabelText("Experience level unknown"),
    ).toBeInTheDocument();
    expect(within(row).getByLabelText("Courage unknown")).toBeInTheDocument();
    expect(within(row).getByLabelText("Stupidity unknown")).toBeInTheDocument();
    expect(
      within(row).getByLabelText("Experience toward next rank unknown"),
    ).toBeInTheDocument();
  });

  /** An applicant's rank is withheld, so only the two trait chips show, and neither may read as a score never quoted. */
  it("says an applicant's missing courage and stupidity are missing", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [{ name: "Nedcas Kerman", trait: "Engineer" }],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    const row = (await screen.findByText("Nedcas Kerman")).closest(
      "li",
    ) as HTMLElement;
    expect(within(row).getByLabelText("Courage unknown")).toBeInTheDocument();
    expect(within(row).getByLabelText("Stupidity unknown")).toBeInTheDocument();
    expect(within(row).queryByText(/^L/)).not.toBeInTheDocument();
  });

  it("gives a standing with zero members no tab (derived, not a fixed list)", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      // Only Available crew this time.
      emitCrewRoster(fixture, [CREW_ROSTER[0]]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    expect(
      await screen.findByRole("tab", { name: "Available (1)" }),
    ).toBeInTheDocument();
    for (const situation of ["Assigned", "Dead", "Missing"]) {
      expect(
        screen.queryByRole("tab", { name: new RegExp(situation, "i") }),
      ).not.toBeInTheDocument();
    }
  });

  it("dispatches career.crew.hire with the applicant name after arm-then-confirm", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    // The first click arms; the label flips to Confirm.
    const hire = await screen.findByRole("button", {
      name: /^Hire Desdin Kerman/,
    });
    await user.click(hire);
    const confirm = await screen.findByRole("button", {
      name: /^Confirm hire of Desdin Kerman/,
    });
    await user.click(confirm);

    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.crew.hire",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ applicantName: "Desdin Kerman" });
    });
  });

  it("dispatches career.crew.fire with the kerbal name after arm-then-confirm, from the Available row only", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await screen.findByText("Bill Kerman");

    const fire = screen.getByRole("button", { name: /^Fire Bill Kerman/ });
    await user.click(fire);
    const confirm = await screen.findByRole("button", {
      name: /^Confirm fire of Bill Kerman/,
    });
    await user.click(confirm);

    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.crew.fire",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ kerbalName: "Bill Kerman" });
    });
  });

  it("never renders a Fire control on Assigned/Dead/Missing rows", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    for (const [tabLabel, kerbalName] of [
      ["Assigned (1)", "Jeb Kerman"],
      ["Dead (1)", "Val Kerman"],
      ["Missing (1)", "Bob Kerman"],
    ] as const) {
      await user.click(await screen.findByRole("tab", { name: tabLabel }));
      await screen.findByText(kerbalName);
      expect(
        screen.queryByRole("button", { name: /^Fire / }),
      ).not.toBeInTheDocument();
    }
  });

  /** Decisions read the STANDING, never a `situation` spelling this build has not seen; tab labels come from the standing too. */
  it("takes the Fire control, the tab label and the critical badge from the standing, not the situation name", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          name: "Ludsy Kerman",
          trait: "Pilot",
          experienceLevel: 1,
          // An unseen word with Available underneath.
          situation: "Ready",
          standing: CrewStanding.Available,
          situationOrdinal: 0,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Sherbald Kerman",
          trait: "Engineer",
          experienceLevel: 1,
          // And one with Dead underneath.
          situation: "Deceased",
          standing: CrewStanding.Dead,
          situationOrdinal: 2,
          available: false,
          unavailableReason: "Deceased",
        },
        // The neutral yardstick the critical badge has to differ from.
        {
          name: "Jeb Kerman",
          trait: "Pilot",
          experienceLevel: 3,
          situation: "Assigned",
          standing: CrewStanding.Assigned,
          situationOrdinal: 1,
          available: false,
          unavailableReason: "On mission",
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    // Tab labels are the standing's own words: a label taken from a spelling KSP owns is one KSP can change.
    await user.click(await screen.findByRole("tab", { name: "Available (1)" }));
    await screen.findByText("Ludsy Kerman");
    expect(
      await screen.findByRole("button", { name: /^Fire / }),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Dead (1)" }));
    await screen.findByText("Sherbald Kerman");
    expect(
      screen.queryByRole("button", { name: /^Fire / }),
    ).not.toBeInTheDocument();
    const deceasedClass = (await screen.findByText("Deceased")).className;

    await user.click(await screen.findByRole("tab", { name: "Assigned (1)" }));
    const onMissionClass = (await screen.findByText("On mission")).className;
    expect(deceasedClass).not.toBe(onMissionClass);
  });

  it("badges an Assigned kerbal's 'On mission' as a neutral chip, and Dead/Missing as critical", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    await user.click(await screen.findByRole("tab", { name: "Assigned (1)" }));
    const onMissionClass = (await screen.findByText("On mission")).className;

    await user.click(await screen.findByRole("tab", { name: "Dead (1)" }));
    const deadClass = (await screen.findByText("Dead")).className;

    await user.click(await screen.findByRole("tab", { name: "Missing (1)" }));
    const missingClass = (await screen.findByText("Missing")).className;

    // On a mission is expected, not alarming; only the two lost situations share the critical styling.
    expect(onMissionClass).not.toBe(deadClass);
    expect(deadClass).toBe(missingClass);
  });

  it("cycles the highlighted Available crew via highlightNextAvailable and fires it via fireHighlighted", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 2,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        CREW_ROSTER[0],
        { ...CREW_ROSTER[0], name: "Val Kerman" },
      ]);
    });
    // The Active tab is opened only to observe the row order the cycle walks.
    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await screen.findByText("Bill Kerman");

    act(() => {
      dispatchAction("astronaut-complex", "highlightNextAvailable", {
        kind: "button",
        value: true,
      });
    });
    act(() => {
      dispatchAction("astronaut-complex", "fireHighlighted", {
        kind: "button",
        value: true,
      });
    });
    // The first press only arms, and says so on the row.
    expect(await screen.findByText("ARMED")).toBeInTheDocument();
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === "career.crew.fire",
      ),
    ).toBeUndefined();

    act(() => {
      dispatchAction("astronaut-complex", "fireHighlighted", {
        kind: "button",
        value: true,
      });
    });

    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.crew.fire",
      );
      expect(sent).toBeDefined();
      // The cycle stepped off Bill onto Val before firing.
      expect(sent?.args).toEqual({ kerbalName: "Val Kerman" });
    });
  });

  it("highlights only a crew member the fire action can reach, and moves off one it cannot", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 2,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          ...CREW_ROSTER[0],
          name: "Resting Kerman",
          standing: CrewStanding.Resting,
        },
        CREW_ROSTER[1],
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await user.click(await screen.findByRole("tab", { name: /^Resting/ }));
    await screen.findByText("Resting Kerman");

    const selected = screen.getAllByText("SELECTED");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.closest("li")?.textContent).toContain("Resting Kerman");
    expect(
      screen
        .getAllByRole("listitem")
        .filter((li) => li.getAttribute("aria-current") === "true"),
    ).toHaveLength(1);

    act(() => {
      dispatchAction("astronaut-complex", "fireHighlighted", {
        kind: "button",
        value: true,
      });
    });
    act(() => {
      dispatchAction("astronaut-complex", "fireHighlighted", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.find(
          (c) => c.command === "career.crew.fire",
        )?.args,
      ).toEqual({ kerbalName: "Resting Kerman" }),
    );
  });

  /** A kerbal standing down gets their own tab, is not offered for a flight, and IS still fireable. */
  it("gives a kerbal standing down their own tab and no flight, but still lets them be fired", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          ...CREW_ROSTER[0],
          standing: CrewStanding.Resting,
          situation: "Resting",
          available: false,
          unavailableReason: "Standing down",
          inactive: true,
          inactiveUntilUt: 8_000_000,
          standingEndsAtUt: 8_000_000,
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    expect(
      await screen.findByRole("tab", { name: "Resting (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /^Available/ }),
    ).not.toBeInTheDocument();

    const row = (await screen.findByText("Bill Kerman")).closest(
      "li",
    ) as HTMLElement;
    // One badge for every way a kerbal cannot fly.
    expect(within(row).getByText("Standing down")).toBeInTheDocument();
    // Firing is not flying, so the control is still offered.
    expect(
      within(row).getByRole("button", { name: /^Fire Bill Kerman/ }),
    ).toBeInTheDocument();
  });

  /**
   * A kerbal a mod backend holds back is refused for a flight with the
   * backend's own reason, though the standing still reads Available: the
   * widget branches on the producer's `available`, not on the standing.
   */
  it("refuses to fly a kerbal a backend holds back, and says why in its words", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          ...CREW_ROSTER[0],
          standing: CrewStanding.Available,
          situation: "Available",
          situationOrdinal: 0,
          available: false,
          unavailableReason: "Held by planted",
          standingEndsAtUt: 9_000_000,
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    expect(
      await screen.findByRole("tab", { name: "Available (1)" }),
    ).toBeInTheDocument();
    const row = (await screen.findByText("Bill Kerman")).closest(
      "li",
    ) as HTMLElement;
    expect(within(row).getByText("Held by planted")).toBeInTheDocument();
    // A kerbal held back is not an alarming state.
    expect(within(row).queryByText("Dead")).not.toBeInTheDocument();
  });

  /** A scheduled end is read off `standingEndsAtUt` and formatted client-side, in the save's own calendar. */
  it("puts the when in the unavailable badge's title, formatted client-side", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 1,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        {
          ...CREW_ROSTER[0],
          standing: CrewStanding.Resting,
          situation: "Resting",
          available: false,
          unavailableReason: "Standing down",
          inactive: true,
          inactiveUntilUt: 9_000_000,
          standingEndsAtUt: 9_000_000,
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    const badge = await screen.findByText("Standing down");
    const title = badge.getAttribute("data-tooltip") ?? "";
    expect(title).toContain("Standing down until ");
    // A rendered date, not the raw UT.
    expect(title).not.toContain("9000000");
  });

  /** With nothing claiming the tab slot, the augment tab does not exist at all. */
  it("grows no augment tab until something claims the slot", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    // Active proves the strip rendered, so the absence below is about the tab.
    expect(await screen.findByRole("tab", { name: "Active" })).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: "Notes" }),
    ).not.toBeInTheDocument();
  });

  /** A bundled client registers its augment whether or not its mod is running, so an absent Domain grows no tab. */
  it("grows no augment tab for an augment whose Domain is not announced, and grows it once the Domain is", async () => {
    registerAugment({
      id: "test-augment-tab-gated",
      augments: "astronaut-complex.tab",
      requires: "absent-notes-mod",
      label: "Notes",
      component: () => <span>Two courses running</span>,
    });
    const availability = createDomainAvailabilityStore();

    render(
      <DomainAvailabilityContext.Provider value={availability}>
        <fixture.Provider>
          <DashboardItemContext.Provider
            value={{ instanceId: "astronaut-complex" }}
          >
            <AstronautComplexComponent
              config={{}}
              id="astronaut-complex"
              w={6}
              h={8}
            />
          </DashboardItemContext.Provider>
        </fixture.Provider>
      </DomainAvailabilityContext.Provider>,
    );
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    expect(await screen.findByRole("tab", { name: "Active" })).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: "Notes" }),
    ).not.toBeInTheDocument();

    act(() => availability.setAvailable("absent-notes-mod", true));

    expect(await screen.findByRole("tab", { name: "Notes" })).toBeVisible();
  });

  /** The tab is a whole TAB beside Applicants and Active, not nested under either, labelled by whatever claims it. */
  it("grows a tab an Uplink fills, labelled by the augment, beside Applicants and Active", async () => {
    registerAugment({
      id: "test-augment-tab",
      augments: "astronaut-complex.tab",
      label: "Notes",
      component: () => <span>Two courses running</span>,
    });

    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    await user.click(await screen.findByRole("tab", { name: "Notes" }));
    expect(await screen.findByText("Two courses running")).toBeInTheDocument();
    // The same strip, not a second one nested inside a tab.
    expect(screen.getByRole("tab", { name: "Applicants" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Active" })).toBeVisible();
  });

  /** An augment that supplies no label still grows a tab, under a generic fallback name. */
  it("falls back to a generic tab label when the augment supplies none", async () => {
    registerAugment({
      id: "test-augment-tab-unlabelled",
      augments: "astronaut-complex.tab",
      component: () => <span>Two courses running</span>,
    });

    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    expect(await screen.findByRole("tab", { name: "Extra" })).toBeVisible();
  });

  /** A claimed slot whose augments all render nothing still says the tab is empty, as Applicants and Active do. */
  it("says the tab is empty rather than showing a blank rectangle", async () => {
    registerAugment({
      id: "test-augment-tab-silent",
      augments: "astronaut-complex.tab",
      label: "Notes",
      component: () => null,
    });

    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    await user.click(await screen.findByRole("tab", { name: "Notes" }));
    expect(await screen.findByText("Nothing here yet")).toBeVisible();
  });

  /** Nothing contributes under stock, so the strip stays three cells with no empty cell. */
  it("keeps the stat strip to its own three figures until something contributes", async () => {
    renderWidgetWithContributions();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    const strip = await screen.findByRole("status");
    expect(within(strip).getByText("Funds")).toBeInTheDocument();
    expect(strip.children).toHaveLength(3);
  });

  /** A contributed figure is a SIBLING cell in the host's own strip, drawn with the host's own `Stat` and `Unit`. */
  it("takes further core stats from an Uplink, in the same row and the same treatment", async () => {
    registerContribution({
      id: "test-crew-in-training",
      contributes: "astronaut-complex.readouts",
      compute: () => [
        {
          id: "in-training",
          label: "In Training",
          value: value("count", 4),
          detail: "across 3 courses",
        },
      ],
    });

    renderWidgetWithContributions();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    const strip = await screen.findByRole("status");
    await waitFor(() =>
      expect(within(strip).getByText("In Training")).toBeInTheDocument(),
    );
    // One row, four cells.
    expect(strip.children).toHaveLength(4);
    // The same cell treatment: a `dl` per stat, label as the `dt`.
    const contributed = within(strip).getByText("In Training");
    expect(contributed.tagName).toBe("DT");
    expect(within(strip).getByText("across 3 courses")).toBeInTheDocument();
  });

  it("renders a bound crew augment per row, carrying that kerbal's identity and standing", async () => {
    // A test Uplink echoes the per-row props: the slot composes once per crew row, with the right kerbal and standing.
    registerAugment<"astronaut-complex.crew">({
      id: "test-crew-schedule",
      augments: "astronaut-complex.crew",
      component: ({ kerbalName, standing, isApplicant }) => (
        <span data-testid="crew-augment">
          {kerbalName}:{standing}:{isApplicant ? "applicant" : "crew"}
        </span>
      ),
    });

    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    // The Applicants list gets one too.
    expect(
      await screen.findByText(
        `Desdin Kerman:${CrewStanding.Applicant}:applicant`,
      ),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await user.click(await screen.findByRole("tab", { name: "Dead (1)" }));

    // The augment gets the standing, not KSP's roster ordinal.
    expect(
      await screen.findByText(`Val Kerman:${CrewStanding.Dead}:crew`),
    ).toBeInTheDocument();
  });

  /** The corner mark is read WITH the name while scanning a roster, for states KSP's own roster does not carry. */
  it("renders a bound corner augment in the identity line, beside the sack control", async () => {
    registerAugment<"astronaut-complex.crew-badge">({
      id: "test-crew-corner",
      augments: "astronaut-complex.crew-badge",
      component: ({ kerbalName }) => (
        <span data-testid="crew-corner">{kerbalName} corner</span>
      ),
    });

    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });

    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await user.click(await screen.findByRole("tab", { name: "Available (1)" }));

    const corner = await screen.findByText("Bill Kerman corner");
    const fire = screen.getByRole("button", { name: /^Fire Bill Kerman/ });
    // The corner mark and the sack control share ONE group at the end of the identity line.
    expect(fire.parentElement).toContainElement(corner);
  });

  /** A row whose standing did not arrive is bucketed as Unknown, not dropped or folded onto Available. */
  it("buckets a row with no standing as Unknown, last", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: [],
        activeCrew: 2,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, [
        CREW_ROSTER[0],
        {
          name: "Nobody Kerman",
          trait: "Pilot",
          experienceLevel: 1,
          situation: "",
          available: false,
          unavailableReason: "",
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    const tabs = screen
      .getAllByRole("tab")
      .map((t) => t.textContent ?? "")
      .filter((label) => label !== "Applicants" && label !== "Active");
    expect(tabs).toEqual(["Available (1)", "Unknown (1)"]);

    await user.click(await screen.findByRole("tab", { name: "Unknown (1)" }));
    expect(await screen.findByText("Nobody Kerman")).toBeInTheDocument();
  });

  /** The hire's own gate says the price is short; the widget draws nothing of its own. */
  it("darkens Hire with the command's own sentence when its gate refuses the price", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 1000); // well under the 24000 hire cost
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    // Short funds alone decide nothing about the control: the command has not said no.
    const live = await screen.findByRole("button", {
      name: /^Hire Desdin Kerman/,
    });
    expect(live).not.toHaveAttribute("aria-disabled");

    act(() => {
      emitHireGate(
        fixture,
        CommandErrorCode.InsufficientFunds,
        "short of funds",
      );
    });
    const hire = await screen.findByRole("button", {
      name: /Hire Desdin Kerman unavailable: short of funds/,
    });
    expect(hire).toHaveAttribute("aria-disabled", "true");
    expect(hire).toHaveAttribute("data-gate", "blocked");
  });

  it("marks the roster full, and Hire takes the cap refusal from the command's gate", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 5,
        crewCapacity: 5,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitHireGate(
        fixture,
        CommandErrorCode.LimitReached,
        "the roster is full",
      );
    });

    expect(await screen.findByText(/FULL/)).toBeInTheDocument();
    const hire = await screen.findByRole("button", {
      name: /Hire Desdin Kerman unavailable: the roster is full/,
    });
    expect(hire).toHaveAttribute("aria-disabled", "true");
  });

  it("renders the crew cap as unlimited (never the raw int.MaxValue sentinel) and never marks the roster full", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 22,
        crewCapacity: UNLIMITED_CREW_CAP,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    expect(await screen.findByText(/22 \/ Unlimited/i)).toBeInTheDocument();
    expect(
      screen.queryByText(String(UNLIMITED_CREW_CAP)),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/FULL/)).not.toBeInTheDocument();
    const hire = screen.getByRole("button", {
      name: /^Hire Desdin Kerman/,
    });
    expect(hire).toBeEnabled();
  });

  it("has no axe violations with a populated applicant pool", async () => {
    const { container } = renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the Active tab's empty state", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");
    await user.click(screen.getByRole("tab", { name: "Active" }));
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on a populated Active tab with multiple situation sub-tabs", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: CREW_ROSTER.length,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
      emitCrewRoster(fixture, CREW_ROSTER);
    });
    await screen.findByText("Desdin Kerman");
    await user.click(screen.getByRole("tab", { name: "Active" }));
    await screen.findByText("Bill Kerman");
    await expectNoA11yViolations(container);
  });

  it("toggles a per-row info popover showing the stock role description and current-rank effects", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");

    const infoButton = screen.getByRole("button", {
      name: "Role info for Desdin Kerman",
    });
    expect(infoButton).toHaveAttribute("aria-expanded", "false");

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/Scientists can analyze certain science experiments/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Level 0: Can analyze Mystery Goo/),
    ).toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(/Scientists can analyze/),
    ).not.toBeInTheDocument();
  });

  it("dismisses the info popover on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");

    const infoButton = screen.getByRole("button", {
      name: "Role info for Desdin Kerman",
    });
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(infoButton).toHaveAttribute("aria-expanded", "false");
    expect(infoButton).toHaveFocus();
  });

  it("shows a graceful no-description state when the wire carries neither string", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Limmy Kerman");

    await user.click(
      screen.getByRole("button", { name: "Role info for Limmy Kerman" }),
    );
    expect(screen.getByText(/no description available/i)).toBeInTheDocument();
  });

  it("has no axe violations with the info popover open (portalled content included)", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: NEXT_HIRE_COST,
      });
    });
    await screen.findByText("Desdin Kerman");
    await user.click(
      screen.getByRole("button", { name: "Role info for Desdin Kerman" }),
    );
    await screen.findByText(/Scientists can analyze/);

    /**
     * Two element-scoped scans, because the popover portals to `document.body`;
     * one body-wide scan would bring axe's page-level "region" rule with it.
     */
    await expectNoA11yViolations(container);
    await expectNoA11yViolations(
      screen.getByRole("group", { name: "Role info for Desdin Kerman" }),
    );
  });
});
