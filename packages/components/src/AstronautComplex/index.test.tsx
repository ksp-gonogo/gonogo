import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
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
    experienceLevel: number;
    situation: string;
    situationOrdinal?: number;
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
      experienceLevel: number;
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

// Spans every stock situation (Available/Assigned/Dead/Missing) plus a mod
// value ("Retired", the RO/RP-1 case the redesign spec calls out) so tests
// can assert the Active tab auto-derives one sub-tab per distinct value with
// no hardcoded list.
const CREW_ROSTER = [
  {
    name: "Bill Kerman",
    trait: "Engineer",
    experienceLevel: 2,
    situation: "Available",
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
    situation: "Retired",
    situationOrdinal: 4,
    available: true,
    unavailableReason: "",
    courage: 0.55,
    stupidity: 0.35,
    experienceLevelDelta: 0.9,
  },
];

describe("AstronautComplexComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  afterEach(() => {
    unmountAll();
    clearActionHandlers();
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

  it("auto-derives one Active sub-tab per distinct situation, incl. a mod value, with per-tab counts and no hardcoded fold", async () => {
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

    // Dead and Missing get their own tabs (not folded into a "Lost" tab),
    // and the mod situation "Retired" gets a tab for free.
    for (const [situation, count] of [
      ["Available", 1],
      ["Assigned", 1],
      ["Dead", 1],
      ["Missing", 1],
      ["Retired", 1],
    ] as const) {
      expect(
        screen.getByRole("tab", { name: `${situation} (${count})` }),
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

  it("gives a situation with zero members no tab (auto-derive, not a fixed list)", async () => {
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
   * `RosterStatus` is KSP's to rename, and both failures are silent and in the
   * wrong direction: the Fire control disappears from every eligible kerbal, and
   * a dead one's badge goes from critical to decorative grey.
   *
   * Both rows below carry a `situation` label this build has never seen, with
   * the ordinal saying what it actually is. The ordinal wins.
   */
  it("takes the Fire control and the critical badge from the ordinal, not the situation name", async () => {
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
          // What KSP might rename RosterStatus.Available to.
          situation: "Ready",
          situationOrdinal: 0,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Sherbald Kerman",
          trait: "Engineer",
          experienceLevel: 1,
          // And RosterStatus.Dead.
          situation: "Deceased",
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
          situationOrdinal: 1,
          available: false,
          unavailableReason: "On mission",
        },
      ]);
    });
    await user.click(await screen.findByRole("tab", { name: "Active" }));

    // The tab LABELS are the unrecognised names, because a label is a label.
    await user.click(await screen.findByRole("tab", { name: "Ready (1)" }));
    await screen.findByText("Ludsy Kerman");
    expect(
      await screen.findByRole("button", { name: /^Fire / }),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Deceased (1)" }));
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
        { ...CREW_ROSTER[0], name: "Val Kerman", situation: "Available" },
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
    expect(await axe(container)).toHaveNoViolations();
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
    expect(await axe(container)).toHaveNoViolations();
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
    expect(await axe(container)).toHaveNoViolations();
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
    await user.click(
      screen.getByRole("button", { name: "Role info for Desdin Kerman" }),
    );
    await screen.findByText(/Scientists can analyze/);

    // The popover portals to `document.body`, outside the render container,
    // so the scan runs against the whole document to actually cover it.
    // Scoping to `container` (as the other axe tests here do) implicitly
    // treats that element as the whole page for landmark purposes; scanning
    // the real `document.body` instead activates axe's page-level "region"
    // rule, which flags this test harness's bare render root as content
    // outside a landmark, a page-chrome concern this component test isn't
    // exercising.
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
