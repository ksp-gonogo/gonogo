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
import {
  RP1_COMPLEX_DISMANTLE_COMMAND,
  RP1_PAD_DISMANTLE_COMMAND,
} from "./Lifecycle";

const TOPICS = [
  "rp1.available",
  "rp1.centres",
  "rp1.complexes",
  "rp1.pads",
  "rp1.personnel",
  "rp1.rushTerms",
  RP1_COMPLEX_RUSH_COMMAND,
  RP1_PERSONNEL_ASSIGN_COMMAND,
  RP1_COMPLEX_DISMANTLE_COMMAND,
  RP1_PAD_DISMANTLE_COMMAND,
];

const CAPE = {
  anyOperational: true,
  engineers: 30,
  idleSalaryPerDay: 4.1,
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
  {
    isOperational: true,
    kscName: "Cape",
    lcId: "lc-1",
    level: 1,
    name: "LP-1",
    padId: "pad-1",
  },
  {
    isOperational: true,
    kscName: "Cape",
    lcId: "lc-2",
    level: 2,
    name: "LP-2",
    padId: "pad-2",
  },
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

/**
 * Everything below a complex's crew now sits behind one expander, on the
 * operator's ruling that a complex was "using a lot of space for quite
 * boilerplate information". `Disclosure` UNMOUNTS its children when closed, so a
 * test whose subject is a stat, a pad or the rush control opens it first.
 */
async function openAllDetail(user: ReturnType<typeof userEvent.setup>) {
  const triggers = await screen.findAllByRole("button", {
    name: /^Detail for /,
  });
  for (const trigger of triggers) await user.click(trigger);
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
    /*
     * "pad complex at Cape" used to be under every complex and is CUT. The
     * operator's reasoning is the important part: "if this is needed the UI isn't
     * working". A label repeated on every row carries no information, and the
     * centre heading above already groups them.
     */
    expect(view.container.textContent).not.toContain("pad complex at");
    await expectNoA11yViolations(view.container);
  });

  it("lists two centres with their own complexes under each", async () => {
    const user = userEvent.setup();
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
    await openAllDetail(user);
    // The complex-kind line is cut; the centre HEADING is what groups them now,
    // which is the operator's point: "if this is needed the UI isn't working".
    expect(screen.getByText("Vandenberg")).toBeInTheDocument();
    // Only one centre is the game's own current view, and the other is still
    // fully administered from here.
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("calls out a complex nobody is assigned to", async () => {
    /*
     * The fact the view exists for: portionEngineers is Engineers/MaxEngineers,
     * so an unstaffed complex advances nothing at all however much the career
     * has hired and however much is queued on it.
     *
     * The badge and nothing else. The sentence that used to sit under the crew
     * bar explaining what the badge meant for the queue is the guidance the
     * operator asked to be rid of, and it stood on every unstaffed complex.
     */
    const { view } = withCentre([
      { ...COMPLEXES[0], engineers: 0 },
      COMPLEXES[1],
    ]);

    await waitFor(() => {
      expect(screen.getByText("NOBODY ASSIGNED")).toBeInTheDocument();
    });
    expect(view.container.textContent ?? "").not.toContain(
      "nothing here advances",
    );
  });

  it("steps the crew, RP-1's own way, and sends a TARGET", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

    /*
     * The step multiplier RP-1 itself offers (1 / 10 / 100 / all), not a range:
     * the act is moving some of the free pool onto this complex, and a range
     * would say "pick a number" about something with two separate ceilings.
     */
    await user.click(
      await screen.findByRole("button", {
        name: "Increase Engineers moved per press at LC-1",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Assign 6 more engineers to LC-1, 24 in all",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_PERSONNEL_ASSIGN_COMMAND,
    );
    /*
     * A set rather than a delta, whatever the control looks like: an operator
     * commanding from a remote vantage is reading a count as it was, and "+10"
     * applied to a count that has since moved lands somewhere nobody chose.
     */
    expect(sent?.args).toEqual({ engineers: 24, lcId: "lc-1" });
  });

  it("presses only what it can move, not the step that was picked", async () => {
    const user = userEvent.setup();
    withCentre();

    // Cape has six free and LC-1 has room for forty-two, so a step of 100 moves
    // six. RP-1 clamps the same way, and the press says so before it is pressed
    // rather than quietly doing something else.
    const raise = await screen.findByRole("button", {
      name: "Increase Engineers moved per press at LC-1",
    });
    await user.click(raise);
    await user.click(raise);
    expect(
      screen.getByRole("spinbutton", {
        name: "Engineers moved per press at LC-1",
      }),
    ).toHaveAttribute("aria-valuetext", "100");

    expect(screen.getByText("+6")).toBeInTheDocument();
    expect(screen.getByText("−18")).toBeInTheDocument();
  });

  it("says a complex is full, rather than that a press is unavailable", async () => {
    // The first of the two ceilings a range control flattens into one end of one
    // track. Nothing is wrong with the centre here: LC-1 simply holds no more.
    withCentre([{ ...COMPLEXES[0], engineers: 60 }, COMPLEXES[1]]);

    // RP-1's own window reads `Max: 60`, and so does this now: the sentence
    // "room here 16" was the operator's "too much flourish".
    await waitFor(() => {
      expect(screen.getAllByText("Max").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "LC-1 is full" })).toBeDisabled();
  });

  it("says the centre has nobody free, which is the other ceiling", async () => {
    // The second, and a different thing to go and fix: hire, or take somebody
    // off another complex. LC-1 has room for forty-two and still cannot grow.
    withCentre(COMPLEXES, [{ ...CAPE, unassignedEngineers: 0 }]);

    // `Unassigned`, which is RP-1's own label for the same figure.
    await waitFor(() => {
      expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("button", {
        name: "No engineers free at Cape to assign to LC-1",
      }),
    ).toBeDisabled();
  });

  it("prices the idle pool on the centre that holds it", async () => {
    // The one figure on this surface that buys nothing. A sentence about the
    // fraction RP-1 pays an idle engineer taught the mod; the daily charge is
    // the number an operator weighs an assignment against.
    const { view } = withCentre();

    await waitFor(() => {
      expect(screen.getByText("Per day")).toBeInTheDocument();
    });
    expect(view.container.textContent).toContain("idle 4.1");
  });

  it("rushes a whole complex on one press", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

    // Nothing is rushing, so nothing here states rushing's terms: they are a
    // reading of a complex that is doing it, not a note about how RP-1 works.
    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    await openAllDetail(user);
    expect(screen.queryByText(/efficiency held/)).not.toBeInTheDocument();

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

  it("offers the way out of rush mode, and states its terms while it runs", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre([
      { ...COMPLEXES[0], isRushing: true },
      COMPLEXES[1],
    ]);

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
    await openAllDetail(user);
    // On the one complex it applies to, as figures. The efficiency term is the
    // one RP-1's own tooltip leaves out and the one that costs most over a
    // career.
    const terms = screen.getByText("rushing").closest("div");
    const termsText = (terms?.textContent ?? "").replace(/\s+/g, " ");
    expect(termsText).toMatch(/150.*rate/);
    expect(termsText).toMatch(/200.*salary/);
    expect(termsText).toContain("efficiency held");

    await user.click(
      screen.getByRole("button", { name: "Stop rushing work at LC-1" }),
    );

    /*
     * A SET and not a toggle on the wire: the command carries the state asked
     * for, so it lands on that state however stale the view it was pressed
     * from.
     */
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
      )?.args,
    ).toEqual({ lcId: "lc-1", rushing: false });
  });

  it("draws the envelope that no amount of staffing gets past", async () => {
    const user = userEvent.setup();
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
    await openAllDetail(user);
    const text = view.container.textContent ?? "";
    /*
     * Eligibility, not assignment: a vehicle over the mass limit cannot be built
     * here at any headcount, and one needing an unhandled resource cannot
     * either.
     */
    expect(text).toContain("180");
    expect(text).toContain("Kerosene, LqdOxygen");
    expect(text).toContain("unlimited");
    expect(text).toContain("unlimited");
    // Same cut. The hangar is still named and its unlimited envelope still reads.
    expect(screen.getByText("Hangar")).toBeInTheDocument();
  });

  it("carries the payroll the standalone panel used to", async () => {
    /*
     * Absorbed on the operator's ruling: staffing a complex IS complex
     * management, and the hiring totals belong beside the assignments that
     * spend them.
     */
    withCentre();

    await waitFor(() => {
      expect(screen.getByText("PAYROLL")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Engineers").length).toBeGreaterThan(0);
    expect(screen.getByText("Researchers")).toBeInTheDocument();
    expect(screen.getByText("Applicants")).toBeInTheDocument();
  });

  it("teaches nobody the mod", async () => {
    // The operator's ruling on this surface: state what IS, in data. An operator
    // who wants the mechanic reads RP-1's docs; an operator at the console wants
    // the number, and prose between the figures is what they scroll past.
    const { view } = withCentre();

    await waitFor(() => {
      expect(screen.getByText("SPACE CENTRES")).toBeInTheDocument();
    });
    const text = view.container.textContent ?? "";
    expect(text).not.toContain("still draws");
    expect(text).not.toContain("one set for the whole career");
    expect(text).not.toContain("earns no efficiency while it runs");
  });

  it("names the centre the way people name it, not the way the save keys it", async () => {
    withCentre(
      [{ ...COMPLEXES[0], kscDisplayName: "Cape Canaveral" }],
      [
        {
          ...CAPE,
          kscDisplayName: "Cape Canaveral",
          kscName: "us_cape_canaveral",
        },
      ],
    );

    await waitFor(() => {
      expect(screen.getByText("Cape Canaveral")).toBeInTheDocument();
    });
    expect(screen.queryByText("us_cape_canaveral")).not.toBeInTheDocument();
  });

  it("falls back to the id on an install with no KSCSwitcher", async () => {
    // Most installs. RP-1 answers null for the display name there, and the id is
    // what the game itself shows, so it is what we show too.
    withCentre([COMPLEXES[0]], [{ ...CAPE, kscName: "Stock" }]);

    await waitFor(() => {
      expect(screen.getByText("Stock")).toBeInTheDocument();
    });
  });

  it("says nothing about the renovation envelope, which was cut", async () => {
    /*
     * Cut on the operator's ruling. massOrig is still on the wire and the modify
     * command still enforces the 2x/0.5x bounds; what went is the sentence
     * explaining them under every complex.
     */
    const { view } = withCentre([
      { ...COMPLEXES[0], massMax: 180, massOrig: 60 },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    expect(view.container.textContent).not.toMatch(/renovation is capped/);
  });

  it("says nothing about renovating a complex whose original tonnage is absent", async () => {
    // The hangar, and any reading RP-1 did not give. An envelope of 3t to 1t is
    // what a substituted zero computes, and it would be printed with the same
    // confidence as a real one.
    const { view } = withCentre([{ ...COMPLEXES[0], massOrig: undefined }]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    expect(view.container.textContent ?? "").not.toMatch(
      /renovation is capped/,
    );
  });

  it("names the complexes this one's crew rating is shared with", async () => {
    const user = userEvent.setup();
    const { view } = withCentre([
      { ...COMPLEXES[0], efficiency: 0.62, efficiencySharedWith: ["lc-2"] },
      { ...COMPLEXES[1], efficiency: 0.62, efficiencySharedWith: ["lc-1"] },
    ]);

    // getAllByText, because "LC-1" now appears twice on purpose: once as its own
    // heading and once as LC-2's shared-rating value.
    await waitFor(() => {
      expect(screen.getAllByText("LC-1").length).toBeGreaterThan(0);
    });
    await openAllDetail(user);
    const text = view.container.textContent ?? "";
    // A label and a value, not a sentence, and still by NAME rather than by the
    // guid the wire joins on.
    expect(screen.getAllByText("Shared with").length).toBe(2);
    expect(text).toContain("LC-2");
    expect(text).toContain("LC-1");
  });

  it("says nothing about sharing when the rating is this complex's alone", async () => {
    const { view } = withCentre([
      { ...COMPLEXES[0], efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    expect(view.container.textContent ?? "").not.toContain(
      "crew rating shared",
    );
  });

  it("counts the pads that WORK, and puts the refusal on the control", async () => {
    /*
     * The count is a reading and the refusal belongs to the press, which is
     * where the repo puts a refused control's reason. It used to be appended to
     * the pads line as prose on every complex down to its last pad.
     */
    const user = userEvent.setup();
    const { view } = withCentre([
      { ...COMPLEXES[0], launchPadCount: 1 },
      { ...COMPLEXES[1], launchPadCount: 3 },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    await openAllDetail(user);
    const text = view.container.textContent ?? "";
    expect(text).toContain("1 operational");
    expect(text).toContain("3 operational");
    expect(text).not.toContain("so none can be dismantled");

    // The one pad LC-1 has left: dark, and carrying its own reason.
    const refused = screen.getByRole("button", {
      name: /LP-1 is the last working pad at this complex/,
    });
    expect(refused).toBeDisabled();
    expect(refused).toHaveAttribute(
      "title",
      "LP-1 is the last working pad at this complex, and a complex must keep one",
    );
  });

  it("names the pads under the complex that owns them", async () => {
    const user = userEvent.setup();
    withCentre();

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    await openAllDetail(user);
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
    /*
     * Named against VEHICLES rather than against the word "build". This widget
     * does build things, it just builds infrastructure: a bare /[Bb]uild/ matched
     * the new-complex control the day it landed, which is a control that belongs
     * here and says nothing about whether a craft has leaked in.
     */
    for (const craft of ["Atlas", "Redstone", "Vanguard"]) {
      expect(screen.queryByText(craft)).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /Roll ?out|Scrap|Recover|Launch/ }),
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
    expect(screen.getByText("No space centre reported")).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("reads a centre with no launch complexes rather than leaving a gap", async () => {
    // RP-1 starts a career with a hangar and no pad complex, so a centre whose
    // pad-side list is empty is a real early-career state. A reading, matching
    // the "no pads" line a complex draws for its own empty case, rather than the
    // sentence that was here.
    withCentre([]);

    await waitFor(() => {
      expect(screen.getByText("no launch complexes")).toBeInTheDocument();
    });
  });

  it("registers itself into the space centre's section slot", () => {
    const ids = getAugmentsForSlot("space-center-status.sections").map(
      (a) => a.id,
    );
    expect(ids).toContain("rp1-ksc-complexes");
  });
});
