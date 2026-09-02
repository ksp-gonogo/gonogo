import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  dispatchAction,
  registerAugment,
} from "@ksp-gonogo/core";
import { CrewStanding } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry. RTL auto-cleanup runs after this file's afterEach,
// so it can't be relied on to unmount first: clearActionHandlers() firing on
// a still-mounted widget is a state update outside act().
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

/**
 * Real-provider integration test: the widget runs off a genuine stream
 * (`setupStreamFixture` = real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` over a `StubTransport`), reading the `spaceCenter.astronautComplex`
 * applicant pool and `career.status`'s funds, and dispatching the real
 * `career.crew.hire` command (asserted against `fixture.transport.sentCommands`).
 * No hooks are mocked.
 */
const CARRIED = [
  "spaceCenter.astronautComplex",
  "spaceCenter.crewRoster",
  "career.status",
  "career.crew.hire",
  "career.crew.fire",
];

// A generous funds balance so affordability never blocks a hire unless a test
// deliberately lowers it.
function emitFunds(fixture: StreamFixture, funds: number | null) {
  fixture.emit("career.status", { economy: { funds } });
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
    standingSource?: string;
    situationOrdinal?: number;
    inactive?: boolean;
    inactiveUntilUt?: number;
    standingEndsAtUt?: number;
    retiresAtUt?: number;
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
    // No roleDescription/descriptionEffects on the wire: the popover's
    // graceful empty state, exercised by a test below.
    name: "Limmy Kerman",
    trait: "Pilot",
    experienceLevel: 0,
    courage: 0.4,
    stupidity: 0.55,
  },
];
const NEXT_HIRE_COST = 24000;
// KSP's int.MaxValue: the sentinel GetActiveCrewLimit returns at the top
// Astronaut Complex tier, an unlimited roster.
const UNLIMITED_CREW_CAP = 2_147_483_647;

// Spans every stock standing plus a real RP-1 retiree, so tests can assert the
// Active tab derives one sub-tab per CrewStanding present with no hardcoded
// list.
//
// Gus is the shape that matters and the shape this fixture used to get wrong. It
// gave him `situationOrdinal: 4`, a RosterStatus member KSP does not declare, on
// the belief that RP-1 appends one. It does not: it writes stock's Dead, ordinal
// 2, which is why every RP-1 retiree reached the Dead tab wearing a red fatality
// badge. So he carries KSP's Dead ordinal AND a Retired standing, attributed to
// the backend that corrected it, which is exactly what the wire carries on a
// live RP-1 career.
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
  {
    name: "Gus Kerman",
    trait: "Pilot",
    experienceLevel: 4,
    // KSP's OWN ordinal is Dead, because that is what RP-1 wrote into it.
    situation: "Retired",
    standing: CrewStanding.Retired,
    standingSource: "rp1",
    situationOrdinal: 2,
    available: false,
    unavailableReason: "Retired",
    courage: 0.55,
    stupidity: 0.35,
    experienceLevelDelta: 0.9,
  },
];

describe("AstronautComplexComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    unmountAll();
    clearActionHandlers();
    clearAugments();
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

  it("renders the panel and a waiting-for-telemetry empty state before telemetry", () => {
    // Before anything has arrived the widget says it is waiting, not that the
    // save is off career: "career mode only" is reserved for the producer
    // confirming there is no Astronaut Complex.
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

    // Wait for the applicant pool to land (the only element unique to the
    // post-emission render) before asserting on the rest of the header.
    await screen.findByText("Desdin Kerman");
    // Funds readout is in-widget (CLAUDE.md funds rule): the "Funds" label.
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
    expect(within(row).getByTitle(/Courage: 65 percent/)).toBeInTheDocument();
    expect(within(row).getByTitle(/Stupidity: 20 percent/)).toBeInTheDocument();
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

  it("derives one Active sub-tab per CrewStanding present, retirees apart from fatalities, with per-tab counts and no hardcoded fold", async () => {
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

    // Dead and Missing get their own tabs (not folded into a "Lost" tab), and
    // so does Retired, which is the whole point: Gus carries KSP's Dead ordinal
    // and must not land in the Dead tab.
    for (const [standing, count] of [
      ["Available", 1],
      ["Assigned", 1],
      ["Retired", 1],
      ["Dead", 1],
      ["Missing", 1],
    ] as const) {
      expect(
        screen.getByRole("tab", { name: `${standing} (${count})` }),
      ).toBeInTheDocument();
    }
    // No hardcoded "Lost" fold tab.
    expect(
      screen.queryByRole("tab", { name: /lost/i }),
    ).not.toBeInTheDocument();

    // The first-derived tab (Available) is active by default and shows its
    // one member through the shared crew-stat row (rank + experience-toward-
    // next-rank included, unlike the Applicants tab which withholds rank).
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    const row = screen.getByText("Bill Kerman").closest("li") as HTMLElement;
    expect(within(row).getByText("L2")).toBeInTheDocument();
    expect(within(row).getByTitle(/Courage: 50 percent/)).toBeInTheDocument();
    expect(
      within(row).getByTitle(/Experience toward next rank: 40 percent/),
    ).toBeInTheDocument();

    // Switching sub-tabs swaps the visible slice of the ONE underlying list.
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

  /**
   * A rank, a courage and a stupidity are all nullable on the wire
   * (`SnapshotDict.GetInt`/`GetDouble` return nothing when the capture had
   * nothing), and a chip the operator can read as a real reading is the one
   * thing they must not become. `L0` is a rookie every save has, so a rank
   * that never arrived reading as one is indistinguishable from the truth;
   * a courage chip that simply vanishes is the same claim made by omission.
   */
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

  /**
   * The same absence one level up: an applicant's rank is withheld by design,
   * so only the two trait chips are on show, and neither may read as a real
   * score the pool never quoted.
   */
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
      // Only Available crew this time: Assigned/Dead/Missing never appear.
      emitCrewRoster(fixture, [CREW_ROSTER[0]]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    expect(
      await screen.findByRole("tab", { name: "Available (1)" }),
    ).toBeInTheDocument();
    for (const situation of ["Assigned", "Dead", "Missing", "Retired"]) {
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

    // First click arms; the label flips to Confirm.
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

  /**
   * The two decisions on this panel that used to read a KSP enum's SPELLING.
   * Both failures are silent and in the wrong direction: the Fire control
   * disappears from every eligible kerbal, and a dead one's badge goes from
   * critical to decorative grey.
   *
   * Every row below carries a `situation` label this build has never seen, with
   * the STANDING saying what it actually is. The standing wins, and the tab
   * labels come from it rather than from the producer's words.
   */
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
          // A word this build has never seen, with Available underneath.
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
        // The neutral yardstick the critical badge has to differ from. Under
        // the old name comparison "Deceased" matched neither "Dead" nor
        // "Missing", so it read neutral and these two classes were equal.
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

    // The tab labels are the STANDING's own words, not the producer's: a label
    // taken from a spelling KSP owns is a label KSP can change.
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

    // Being on a mission is expected, not alarming: it must not share the
    // critical badge's styling, while the two genuinely lost situations do.
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
    // The action-driven highlight/fire path doesn't require the Active tab to
    // be open (the highlighted index lives at the top of the widget, not
    // inside the tab panel), but switching to it lets the test observe the
    // row order the cycle walks over.
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

    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.crew.fire",
      );
      expect(sent).toBeDefined();
      // The cycle stepped off Bill (index 0) onto Val (index 1) before firing.
      expect(sent?.args).toEqual({ kerbalName: "Val Kerman" });
    });
  });

  /**
   * THE defect, at the widget. RP-1 retires a kerbal by writing stock's Dead
   * into rosterStatus, so before the crew-standing capability every retiree sat
   * in the Dead tab wearing the red fatality badge, and a mission-control board
   * told an operator their astronauts had been killed.
   *
   * Gus is that kerbal: KSP's own ordinal says Dead, the standing says Retired.
   * He belongs in his own tab, and his badge must NOT share the styling of the
   * two standings that are worth alarming somebody over.
   */
  it("puts an RP-1 retiree in a Retired tab and not in the Dead tab, with a badge that is not a fatality", async () => {
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

    await user.click(await screen.findByRole("tab", { name: "Dead (1)" }));
    expect(await screen.findByText("Val Kerman")).toBeInTheDocument();
    expect(screen.queryByText("Gus Kerman")).not.toBeInTheDocument();
    const deadClass = (await screen.findByText("Dead")).className;

    await user.click(await screen.findByRole("tab", { name: "Retired (1)" }));
    expect(await screen.findByText("Gus Kerman")).toBeInTheDocument();
    const retiredClass = (await screen.findByText("Retired")).className;

    // Retiring is not dying, and the badge has to say so: the whole content of
    // the defect was these two rendering identically.
    expect(retiredClass).not.toBe(deadClass);
  });

  /**
   * The Fire control is offered on the Available standing alone. A retiree
   * carries KSP's Available-adjacent Dead ordinal, but the standing is what
   * decides, and firing a retiree is not an action any operator meant.
   */
  it("offers no Fire control on a Retired row", async () => {
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
    await user.click(await screen.findByRole("tab", { name: "Retired (1)" }));
    await screen.findByText("Gus Kerman");

    expect(
      screen.queryByRole("button", { name: /^Fire / }),
    ).not.toBeInTheDocument();
  });

  /**
   * A kerbal standing down gets their own tab, is not offered for a flight, and
   * IS still fireable.
   *
   * This case used to assert the opposite, and the comment above it argued for
   * it: "resting is not a standing", so the kerbal stayed in the Available tab
   * wearing a bespoke RESTING badge. That was the third place the same false
   * premise was written down, after a doc comment on the wire type and a
   * provider test, all three green. The producer now derives the standing, so
   * the tab and the unavailability come for free and this widget needed no
   * knowledge of what a stand-down is.
   */
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
    // The one badge for every way a kerbal cannot fly, not a per-axis badge.
    expect(within(row).getByText("Standing down")).toBeInTheDocument();
    // Firing is not flying: the roster accepts a sacking here, so the control
    // must still be offered.
    expect(
      within(row).getByRole("button", { name: /^Fire Bill Kerman/ }),
    ).toBeInTheDocument();
  });

  /**
   * THE case for the whole capability, stated as an operator would hit it: this
   * widget contains no reference to RP-1, no notion of a training course, and no
   * knowledge of the `Training` standing beyond the enum it imports. Fed a kerbal
   * mid-course, it must refuse to offer them for a flight and say why.
   *
   * <p>That works because the producer sends a DERIVED `available` /
   * `unavailableReason` pair beside the raw standing, and because `available` is
   * a whitelist: a standing this widget had never heard of would still read as
   * unavailable. The failure this replaces is the one the branch shipped with,
   * where a trainee reached the wire `available: true` and this widget would have
   * cheerfully offered them.</p>
   */
  it("refuses to fly a kerbal in training it knows nothing about, and says why", async () => {
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
          standing: CrewStanding.Training,
          situation: "Training",
          standingSource: "rp1",
          // KSP's own ordinal is Available throughout a course: the game field
          // is not the answer, which is the premise of the whole capability.
          situationOrdinal: 0,
          available: false,
          unavailableReason: "In training",
          standingEndsAtUt: 9_000_000,
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    expect(
      await screen.findByRole("tab", { name: "Training (1)" }),
    ).toBeInTheDocument();
    const row = (await screen.findByText("Bill Kerman")).closest(
      "li",
    ) as HTMLElement;
    expect(within(row).getByText("In training")).toBeInTheDocument();
    // Not a fatality badge: an unavailable trainee is not an alarming state.
    expect(within(row).queryByText("Dead")).not.toBeInTheDocument();
  });

  /**
   * A standing with a scheduled end reads its WHEN off `standingEndsAtUt`, and
   * the client formats the date. The producer never sends a formatted one: it
   * would be formatted in the mod's calendar, and an RSS save does not count
   * years the way a stock one does.
   */
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
          standing: CrewStanding.Training,
          situation: "Training",
          available: false,
          unavailableReason: "In training",
          standingEndsAtUt: 9_000_000,
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    const badge = await screen.findByText("In training");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("In training until ");
    // A rendered date rather than the raw UT the wire carried.
    expect(title).not.toContain("9000000");
  });

  /**
   * Stock KSP has no crew training, so there is nothing to put behind a
   * Training tab and the strip stays two wide. The tab is not empty-and-present,
   * it does not exist: an unfillable tab is a promise the widget cannot keep.
   */
  it("grows no Training tab until something claims the slot", async () => {
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

    // Active is the positive signal that the strip rendered at all, so the
    // absence below is about a tab that was not offered.
    expect(await screen.findByRole("tab", { name: "Active" })).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: "Training" }),
    ).not.toBeInTheDocument();
  });

  /**
   * A whole TAB rather than a section under the roster, and beside Applicants
   * and Active rather than nested under either: a course is a thing in its own
   * right that several kerbals share, so it is not a footnote to any one row.
   */
  it("grows a Training tab an Uplink fills, beside Applicants and Active", async () => {
    registerAugment({
      id: "test-training-tab",
      augments: "astronaut-complex.training",
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

    await user.click(await screen.findByRole("tab", { name: "Training" }));
    expect(await screen.findByText("Two courses running")).toBeInTheDocument();
    // Same strip, not a second one nested inside a tab.
    expect(screen.getByRole("tab", { name: "Applicants" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Active" })).toBeVisible();
  });

  it("renders a bound crew augment per row, carrying that kerbal's identity and standing", async () => {
    // A test Uplink binds `astronaut-complex.crew` and echoes back the per-row
    // props. Proves (a) the slot is exposed, (b) an augment composes into it
    // once per crew row, and (c) the props carry the right kerbal and standing,
    // so a career-overhaul Uplink can look up that kerbal's own schedule.
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

    // The Applicants list gets one too: RP-1 gives an applicant a retirement
    // date and retires them out of the pool.
    expect(
      await screen.findByText(
        `Desdin Kerman:${CrewStanding.Applicant}:applicant`,
      ),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Active" }));
    await user.click(await screen.findByRole("tab", { name: "Retired (1)" }));

    // The augment is handed the CORRECTED standing, not KSP's Dead ordinal, so
    // it never has to undo the conflation itself. Composed from the enum rather
    // than spelled as a number: the ordinal written out here went stale the
    // moment the contract inserted a member.
    expect(
      await screen.findByText(`Gus Kerman:${CrewStanding.Retired}:crew`),
    ).toBeInTheDocument();
  });

  /**
   * A row whose standing did not arrive is bucketed as Unknown rather than
   * dropped or quietly folded onto Available. Unknown is a third answer: the
   * kerbal exists and where they stand is not known.
   */
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

  it("disables hire when funds are short of the cost", async () => {
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

    const hire = await screen.findByRole("button", {
      name: /Hire Desdin Kerman.*Insufficient funds/,
    });
    expect(hire).toBeDisabled();
  });

  it("marks the roster full and disables hire at the Astronaut Complex cap", async () => {
    renderWidget();
    act(() => {
      emitFunds(fixture, 500000);
      emitComplex(fixture, {
        applicants: APPLICANTS,
        activeCrew: 5,
        crewCapacity: 5,
        nextHireCost: NEXT_HIRE_COST,
      });
    });

    expect(await screen.findByText(/FULL/)).toBeInTheDocument();
    const hire = screen.getByRole("button", {
      name: /Hire Desdin Kerman.*Roster full/,
    });
    expect(hire).toBeDisabled();
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
     * Two scans, because the popover portals to `document.body` and so sits
     * outside the render container: the container covers the row and its
     * trigger, the panel covers the content the portal moved.
     *
     * <p>One scan of `document.body` would cover both and brings axe's
     * page-level "region" rule with it, which flags this harness's bare render
     * root as content outside a landmark: page chrome this component test does
     * not own. Two element-scoped scans ask the same question of the same
     * nodes without arguing about the page.</p>
     */
    await expectNoA11yViolations(container);
    await expectNoA11yViolations(
      screen.getByRole("group", { name: "Role info for Desdin Kerman" }),
    );
  });
});
