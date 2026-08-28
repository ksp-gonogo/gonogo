import {
  act,
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  KscComplexes,
  RP1_COMPLEX_RUSH_COMMAND,
  RP1_PERSONNEL_ASSIGN_COMMAND,
} from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.centres",
  "rp1.complexes",
  "rp1.pads",
  "rp1.personnel",
  "rp1.rushTerms",
  RP1_COMPLEX_RUSH_COMMAND,
  RP1_PERSONNEL_ASSIGN_COMMAND,
];

const CAPE = {
  anyOperational: true,
  engineers: 30,
  isActive: true,
  kscName: "Cape",
  launchComplexCount: 2,
  salaryPerDay: 61.6,
  unassignedEngineers: 6,
  upkeepPerDay: 75,
};

const COMPLEXES = [
  {
    engineers: 18,
    isOperational: true,
    isRushing: false,
    kscName: "Cape",
    lcId: "lc-1",
    lcType: "Pad",
    massMax: 180,
    massMin: 6,
    maxEngineers: 60,
    name: "LC-1",
    salaryPerDay: 49.3,
    upkeepPerDay: 45,
  },
  {
    engineers: 6,
    isOperational: true,
    isRushing: false,
    kscName: "Cape",
    lcId: "lc-2",
    lcType: "Pad",
    maxEngineers: 40,
    name: "LC-2",
    salaryPerDay: 16.4,
    upkeepPerDay: 30,
  },
];

const PADS = [
  { kscName: "Cape", lcId: "lc-1", level: 1, name: "LP-1", padId: "pad-1" },
  { kscName: "Cape", lcId: "lc-2", level: 2, name: "LP-2", padId: "pad-2" },
];

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscComplexes />
    </fixture.Provider>,
  );
  return { fixture, view };
}

function withCentre(
  complexes: readonly Record<string, unknown>[] = COMPLEXES,
  centres: readonly Record<string, unknown>[] = [CAPE],
) {
  const mounted = mount();
  act(() => {
    mounted.fixture.emit("rp1.available", true);
    mounted.fixture.emit("rp1.centres", centres);
    mounted.fixture.emit("rp1.complexes", complexes);
    mounted.fixture.emit("rp1.pads", PADS);
    mounted.fixture.emit("rp1.personnel", {
      applicants: 7,
      engineerSalaryPerDay: 61.6,
      idleSalaryMult: 0.25,
      researcherSalaryPerDay: 20,
      researchers: 31,
      totalEngineers: 30,
    });
    mounted.fixture.emit("rp1.rushTerms", { rateMult: 1.5, salaryMult: 2 });
  });
  return mounted;
}

describe("KscComplexes", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("says a complex belongs to a centre, and which", async () => {
    // The whole reason this section is nested rather than flat. An operator who
    // reads LC-1 as a facility, or as a centre, cannot act on any of the three
    // layers, and that has happened twice.
    const { view } = withCentre();

    await waitFor(() => {
      expect(screen.getByText("SPACE CENTRES")).toBeInTheDocument();
    });
    expect(screen.getByText("Cape")).toBeInTheDocument();
    expect(screen.getByText("LC-1")).toBeInTheDocument();
    expect(screen.getAllByText(/pad complex at Cape/)).toHaveLength(2);
    // And the layer above, which is the host widget's and not a centre's.
    expect(
      screen.getByText(/facilities above are one set for the whole career/i),
    ).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("lists two centres with their own complexes under each", async () => {
    withCentre(
      [
        ...COMPLEXES,
        {
          engineers: 0,
          isOperational: true,
          isRushing: false,
          kscName: "Vandenberg",
          lcId: "slc-3",
          lcType: "Pad",
          maxEngineers: 40,
          name: "SLC-3",
        },
      ],
      [
        CAPE,
        {
          anyOperational: true,
          engineers: 12,
          isActive: false,
          kscName: "Vandenberg",
          launchComplexCount: 1,
          unassignedEngineers: 12,
        },
      ],
    );

    await waitFor(() => {
      expect(screen.getByText("Vandenberg")).toBeInTheDocument();
    });
    expect(screen.getByText(/pad complex at Vandenberg/)).toBeInTheDocument();
    // Only one centre is the game's own current view, and the other is still
    // fully administered from here.
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("calls out a complex nobody is assigned to", async () => {
    // The fact the view exists for: portionEngineers is Engineers/MaxEngineers,
    // so an unstaffed complex advances nothing at all however much the career
    // has hired and however much is queued on it.
    withCentre([{ ...COMPLEXES[0], engineers: 0 }, COMPLEXES[1]]);

    await waitFor(() => {
      expect(screen.getByText("NOBODY ASSIGNED")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/nothing here advances until someone is/),
    ).toBeInTheDocument();
  });

  it("sends a crew TARGET, not a step", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

    const field = await screen.findByLabelText("Crew for LC-1");
    await user.clear(field);
    await user.type(field, "24");
    await user.click(
      screen.getByRole("button", { name: /Leave 24 engineers at LC-1/ }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_PERSONNEL_ASSIGN_COMMAND,
    );
    // A set rather than a delta: an operator commanding from a remote vantage is
    // reading a count as it was, and a step applied to a count that has since
    // moved lands somewhere nobody chose.
    expect(sent?.args).toEqual({ engineers: 24, lcId: "lc-1" });
  });

  it("offers no crew above what the centre has free", async () => {
    withCentre();

    // 18 assigned, 6 unassigned at Cape, so 24 is the most this complex could
    // hold today even though it can hold 60. The control offers no number the
    // command would refuse.
    const field = await screen.findByLabelText("Crew for LC-1");
    expect(field).toHaveAttribute("max", "24");
  });

  it("rushes a whole complex on one press, and prices it first", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

    await waitFor(() => {
      expect(
        screen.getAllByText(/earns no efficiency while it runs/).length,
      ).toBeGreaterThan(0);
    });

    // One press, unlike the vehicle controls in Vehicle Assembly, and the
    // difference is real: rushing spends nothing when it lands. It raises the
    // rate and doubles the salary, so the cost arrives later as payroll.
    await user.click(
      await screen.findByRole("button", {
        name: "Rush work at LC-1, at double the salary",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
    );
    // The COMPLEX, never a vehicle: IsRushing is a bool on the launch complex,
    // so a per-vehicle rush would be a lie about what the game does.
    expect(sent?.args).toEqual({ lcId: "lc-1", rushing: true });
  });

  it("offers the way out of rush mode to a complex already in it", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre([
      { ...COMPLEXES[0], isRushing: true },
      COMPLEXES[1],
    ]);

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: "Stop rushing work at LC-1" }),
    );

    // A SET and not a toggle on the wire: the command carries the state asked
    // for, so it lands on that state however stale the view it was pressed
    // from.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
      )?.args,
    ).toEqual({ lcId: "lc-1", rushing: false });
  });

  it("draws the envelope that no amount of staffing gets past", async () => {
    const { view } = withCentre([
      { ...COMPLEXES[0], resourcesHandled: ["Kerosene", "LqdOxygen"] },
      {
        // The hangar, whose mass and size RP-1 leaves unlimited. A client that
        // printed the float sentinel would show a number where the answer is
        // "anything".
        engineers: 2,
        isOperational: true,
        isRushing: false,
        kscName: "Cape",
        lcId: "hangar",
        lcType: "Hangar",
        maxEngineers: 10,
        name: "Hangar",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Hangar")).toBeInTheDocument();
    });
    const text = view.container.textContent ?? "";
    // Eligibility, not assignment: a vehicle over the mass limit cannot be built
    // here at any headcount, and one needing an unhandled resource cannot
    // either.
    expect(text).toContain("180");
    expect(text).toContain("Kerosene, LqdOxygen");
    expect(text).toContain("any mass");
    expect(text).toContain("any size");
    expect(screen.getByText(/hangar complex at Cape/)).toBeInTheDocument();
  });

  it("carries the payroll the standalone panel used to", async () => {
    // Absorbed on the operator's ruling: staffing a complex IS complex
    // management, and the hiring totals belong beside the assignments that
    // spend them.
    withCentre();

    await waitFor(() => {
      expect(screen.getByText("Engineers")).toBeInTheDocument();
    });
    expect(screen.getByText("Researchers")).toBeInTheDocument();
    expect(screen.getByText("Applicants")).toBeInTheDocument();
    expect(
      screen.getByText(/assigned to nothing still draws/),
    ).toBeInTheDocument();
  });

  it("names the pads under the complex that owns them", async () => {
    withCentre();

    await waitFor(() => {
      expect(screen.getByText(/LP-1/)).toBeInTheDocument();
    });
    expect(screen.getByText(/LP-2/)).toBeInTheDocument();
  });

  it("lists no vehicles: those moved to Vehicle Assembly", async () => {
    // The half of the split that is easy to half-do. This section answers what
    // infrastructure the career has and how it is run; a craft named here would
    // put the same card in two widgets.
    withCentre();

    await waitFor(() => {
      expect(screen.getByText("SPACE CENTRES")).toBeInTheDocument();
    });
    expect(screen.queryByText("IN THE WAREHOUSE")).not.toBeInTheDocument();
    expect(screen.queryByText("UNDER INTEGRATION")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /[Bb]uild/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when RP-1 has answered for nothing yet", async () => {
    // Present and silent, which is a state rather than a fault. Every count
    // reads as the null token: the same scene the standalone payroll panel held,
    // and the reason it was worth holding is that a stack of labels with blank
    // space beside them looks like a finished layout.
    const { fixture, view } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
    });

    await waitFor(() => {
      expect(screen.getByText("Engineers")).toBeInTheDocument();
    });
    expect(
      screen.getByText("RP-1 has not reported a space centre."),
    ).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("names a centre with no launch complexes rather than leaving a gap", async () => {
    // RP-1 starts a career with a hangar and no pad complex, so a centre whose
    // pad-side list is empty is a real early-career state.
    withCentre([]);

    await waitFor(() => {
      expect(
        screen.getByText("No launch complexes at Cape yet."),
      ).toBeInTheDocument();
    });
  });

  it("registers itself into the space centre's section slot", () => {
    const ids = getAugmentsForSlot("space-center-status.sections").map(
      (a) => a.id,
    );
    expect(ids).toContain("rp1-ksc-complexes");
  });
});
