import { kspCalendar, setKspCalendar } from "@ksp-gonogo/sitrep-sdk";
import {
  render,
  screen,
  setupStreamFixture,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { PROGRAMS_SCREEN_ID } from "../AdminBuilding/programsScreen";
import { ProgramDetail } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.programs",
  "rp1.programSlots",
  "rp1.programFundingCurves",
  "rp1.confidence",
  "career.status",
];

const YEAR = 31_557_600;

/**
 * RP-1's shipped `Flat` curve. Chosen for the same reason the arithmetic tests
 * choose it: it is exactly linear from 0 to 1, so a four-year Program on it pays
 * exactly a quarter of its total per year and every figure below is checkable.
 */
function flatCurve() {
  return {
    name: "Flat",
    isDefault: true,
    keys: [
      { frac: 0, paidFraction: 0, inTangent: 1, outTangent: 1 },
      { frac: 1, paidFraction: 1, inTangent: 1, outTangent: 0.8 },
      { frac: 2, paidFraction: 1.4, inTangent: 0.25, outTangent: 0.25 },
    ],
  };
}

function program(overrides: Record<string, unknown> = {}) {
  return {
    name: "EarlyXPlanes",
    title: "X-Plane Research",
    state: "active",
    speed: "Normal",
    slots: 2,
    isHumanSpaceflight: true,
    nominalDurationSeconds: 4 * YEAR,
    durationSeconds: 4 * YEAR,
    acceptedUt: 1_000,
    deadlineUt: 285_000_000,
    objectivesCompletedUt: null,
    completedUt: null,
    lastPaymentUt: 40_000,
    fracElapsed: 0.25,
    totalFunding: 400_000,
    fundsPaidOut: 100_000,
    fundsRemaining: 300_000,
    fundingCurve: "Flat",
    confidenceCost: 350,
    repDeltaOnCompletePerYearEarly: 130,
    repPenaltyPerYearLate: 130,
    repPenaltyAssessed: 0,
    requirementsMet: true,
    objectivesMet: false,
    canAccept: false,
    canComplete: false,
    requirementsText: null,
    objectivesText: "Fly the X-Planes.",
    speedOptions: [
      { speed: "Slow", confidenceCost: 0, durationSeconds: 6 * YEAR },
      { speed: "Normal", confidenceCost: 350, durationSeconds: 4 * YEAR },
      { speed: "Fast", confidenceCost: 700, durationSeconds: 3 * YEAR },
    ],
    programsToDisableOnAccept: null,
    fundingPayments: [
      { year: 2, funds: 100_000, cumulativeFunds: 200_000 },
      { year: 3, funds: 100_000, cumulativeFunds: 300_000 },
      { year: 4, funds: 100_000, cumulativeFunds: 400_000 },
    ],
    ...overrides,
  };
}

function slots(overrides: Record<string, unknown> = {}) {
  return {
    maxSlots: 3,
    usedSlots: 2,
    freeSlots: 1,
    activeCount: 1,
    completedCount: 0,
    ...overrides,
  };
}

function mount(screenId: string = PROGRAMS_SCREEN_ID) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <ProgramDetail screenId={screenId} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** The healthy scene: RP-1 present, one Program running, its curve published. */
async function feed(
  fixture: ReturnType<typeof setupStreamFixture>,
  rows: ReturnType<typeof program>[] = [program()],
) {
  fixture.emit("rp1.available", true);
  fixture.emit("rp1.programs", rows);
  fixture.emit("rp1.programSlots", slots());
  fixture.emit("rp1.programFundingCurves", [flatCurve()]);
  fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });
  fixture.emit("career.status", { economy: { funds: 289_848 } });
  await waitFor(() => {
    expect(screen.getByText(/PROGRAM DETAIL/)).toBeInTheDocument();
  });
}

describe("ProgramDetail", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows both balances, because it quotes a price in one and income in the other", async () => {
    /*
     * The repo's spend rule, and it binds twice here: Confidence is what buys a
     * Program and funds are what it pays back, so an operator weighing an offer
     * needs both without leaving the widget.
     */
    const { fixture } = mount();
    await feed(fixture);

    const text = visibleText();
    expect(text).toContain("289,848");
    expect(text).toContain("500");
  });

  it("opens on the running Program when nothing is pinned", async () => {
    /*
     * An unconfigured instance should be useful: the Program paying the career
     * is the one worth opening on, and RP-1's catalogue order would put a locked
     * 1980s Program first.
     *
     * Read off the catalogue's own pressed row rather than off the page text.
     * Every Program's NAME is on screen now that the list stands open, so an
     * absence assertion on the name would only be re-asserting that the list is
     * hidden; what says which one is open is the selection and the detail.
     */
    const { fixture } = mount();
    await feed(fixture, [
      program({
        name: "Aeronautics",
        title: "Aeronautics",
        state: "locked",
        objectivesText: "Break the sound barrier.",
      }),
      program(),
    ]);

    expect(
      await screen.findByRole("button", { name: /X-Plane Research ACTIVE/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Aeronautics LOCKED/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Fly the X-Planes.")).toBeInTheDocument();
    expect(screen.queryByText("Break the sound barrier.")).toBeNull();
  });

  /*
   * Not a dropdown, which is the operator's own ruling: a select shows one
   * entry and hides the state of every other, so the catalogue could not be
   * scanned.
   *
   * And not behind an expander either, which is what replaced the dropdown and
   * is what the operator could not find: "I also don't see the way that you'd
   * choose and browse, or select a program". A small button labelled "Choose
   * program" above a standing detail is a browse affordance you have to already
   * know is there. The list is what says a choice exists, so the list stands
   * open beside the detail, which is also what the game's own Administration
   * screen does.
   */
  it("stands the catalogue open beside the detail rather than hiding it", async () => {
    const { fixture } = mount();
    await feed(fixture, [
      program({ name: "Aeronautics", title: "Aeronautics", state: "locked" }),
      program(),
    ]);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Choose a Program/ }),
    ).toBeNull();
    // Every Program, each carrying its own state, without pressing anything.
    const catalogue = screen.getByRole("group", { name: "Program catalogue" });
    expect(
      within(catalogue).getByRole("button", { name: /Aeronautics LOCKED/ }),
    ).toBeInTheDocument();
    expect(
      within(catalogue).getByRole("button", {
        name: /X-Plane Research ACTIVE/,
      }),
    ).toBeInTheDocument();
  });

  it("draws no catalogue at all when RP-1 has sent none", async () => {
    // A picker whose only entry is the null token is a control that cannot be
    // used, so the empty state stands alone rather than beside an empty list.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", []);

    await waitFor(() => {
      expect(screen.getByText(/PROGRAM DETAIL/)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("group", { name: "Program catalogue" }),
    ).toBeNull();
    expect(
      screen.getByText("RP-1 has not sent a Program catalogue"),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /*
   * An augment is bound to the SLOT, so every screen of the building mounts it
   * and it is handed the screen's id to decide on. Without this it would draw
   * the Programs detail under a Leaders or a Finances tab.
   */
  it("draws nothing on a screen that is not Programs", async () => {
    const { fixture, view } = mount("leaders");
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [program()]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("lets the operator pick any Program, running or not", async () => {
    const { fixture } = mount();
    await feed(fixture, [
      program({
        name: "Aeronautics",
        title: "Aeronautics",
        state: "locked",
        objectivesText: "Break the sound barrier.",
      }),
      program(),
    ]);

    // Each row carries the Program's state, which is the whole reason the
    // dropdown went: the catalogue is scannable without opening every entry.
    const row = await screen.findByRole("button", {
      name: /Aeronautics LOCKED/,
    });
    await userEvent.click(row);

    expect(row).toHaveAttribute("aria-pressed", "true");
    // The detail pane names its own subject, so the Program every reading below
    // it is about is named without reading the list again. Two matches: the
    // row that was pressed, and the pane's own heading.
    expect(screen.getAllByText("Aeronautics")).toHaveLength(2);
    /* The detail follows the heading: the picked Program's own objectives are in
       the body and the running one's are gone, so the pick moved the whole
       surface rather than just the row's highlight. */
    expect(screen.getByText("Break the sound barrier.")).toBeInTheDocument();
    expect(screen.queryByText("Fly the X-Planes.")).toBeNull();
  });

  it("tabulates the per-year funding summary RP-1 sends", async () => {
    const { fixture } = mount();
    await feed(fixture);

    const table = await screen.findByRole("table", {
      name: /per nominal year/,
    });
    // A running Program's summary starts where the career has got to, so year 1
    // is deliberately absent: it has already been paid.
    expect(table).toHaveTextContent("2");
    expect(table).toHaveTextContent("400,000");
  });

  it("prices all three speeds and flags the ones out of reach", async () => {
    const { fixture } = mount();
    await feed(fixture, [
      program({ speedOptions: program().speedOptions, fundingPayments: null }),
    ]);
    fixture.emit("rp1.confidence", { confidence: 400, earned: 0 });

    const table = await screen.findByRole("table", { name: /each speed/ });
    await waitFor(() => {
      expect(table).toHaveTextContent("Fast");
    });
    expect(table).toHaveTextContent("Slow");
    expect(table).toHaveTextContent("Normal");
    // 400 Confidence held: Normal at 350 is affordable, Fast at 700 is not.
    expect(table).toHaveTextContent("SHORT");
  });

  /*
   * PER YEAR, matching RP-1's own Program screen. The cumulative series only
   * ever rises, so front- or back-loading shows in it as a change of slope and
   * nothing else; the rate shows it directly. The cumulative figures are still
   * in the table below the chart.
   */
  it("draws the funding curve as a labelled graphic", async () => {
    const { fixture, view } = mount();
    await feed(fixture);

    const chart = await screen.findByRole("img", {
      name: /Funding per year over the duration of X-Plane Research/,
    });
    // The stroke has to be a real polyline over real points. A chart that
    // rendered its frame and no line looks identical to one with no data.
    expect(chart.querySelector("polyline")).not.toBeNull();
    expect(
      (chart.querySelector("polyline")?.getAttribute("points") ?? "").length,
    ).toBeGreaterThan(20);
    await expectNoA11yViolations(view.container);
  });

  it("says the curve table is missing rather than drawing a flat line at zero", async () => {
    // The distinction the whole chart rests on. A curve nobody could read draws
    // as a line along the bottom of a funds axis, which is a claim that the
    // Program pays nothing, and that is a different Program.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [program()]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });
    fixture.emit("career.status", { economy: { funds: 289_848 } });

    await waitFor(() => {
      expect(
        screen.getByText(/has not sent its funding-curve table/),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("img", { name: /Cumulative funding/ }),
    ).toBeNull();
  });

  it("refuses to put a funds axis on a Program whose total it could not read", async () => {
    const { fixture } = mount();
    await feed(fixture, [program({ totalFunding: null })]);

    await waitFor(() => {
      expect(
        screen.getByText(/no funding curve for this Program/),
      ).toBeInTheDocument();
    });
  });

  it("names the fallback curve as the fallback rather than as the Program's own", async () => {
    // RP-1's settings return the default curve for a name they do not hold as
    // well as for no name, so the Program IS paid on it. Saying which is what
    // stops that reading as a choice the Program made.
    const { fixture } = mount();
    await feed(fixture, [program({ fundingCurve: null })]);

    await waitFor(() => {
      expect(screen.getByText("Flat (default)")).toBeInTheDocument();
    });
  });

  it("shows no funding summary at all for a completed Program", async () => {
    // RP-1's own rule. A table of what a finished Program once would have paid
    // reads as money still coming.
    const { fixture } = mount();
    await feed(fixture, [
      program({
        state: "completed",
        completedUt: 300_000_000,
        fundingPayments: null,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("table", { name: /per nominal year/ }),
    ).toBeNull();
  });

  it("says a deadline is not set rather than inventing one", async () => {
    // RP-1 writes the deadline on its own funding tick, so a Program accepted
    // and not yet funded genuinely has none.
    const { fixture } = mount();
    await feed(fixture, [program({ deadlineUt: null })]);

    await waitFor(() => {
      expect(screen.getByText(/not set/)).toBeInTheDocument();
    });
  });

  it("names the Programs an accept would close off", async () => {
    const { fixture } = mount();
    await feed(fixture, [
      program({
        state: "offerable",
        programsToDisableOnAccept: ["CrewedOrbit", "Munar"],
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("CrewedOrbit")).toBeInTheDocument();
    });
    expect(screen.getByText("Munar")).toBeInTheDocument();
  });

  it("measures a Program's term on the calendar the game is running", async () => {
    // RP-1 declares a duration in Julian years and the kit's `s` ladder
    // measures a year on whatever calendar the running game published. Under
    // RSS, which is what RP-1 ships on, that is an Earth year and a seven-year
    // Program reads as seven years.
    //
    // Worth a test rather than an assumption because the two calendars differ
    // by a factor of twenty-four: on stock Kerbin's 426 six-hour days the same
    // duration renders as "24y", and a render harness with no calendar emit
    // shows exactly that. This is the fact that says the harness is on its
    // default rather than the widget being wrong.
    const original = kspCalendar();
    try {
      setKspCalendar({
        minute: 60,
        hour: 3_600,
        day: 86_400,
        year: 365 * 86_400,
      });
      const { fixture } = mount();
      await feed(fixture, [
        program({
          durationSeconds: 7 * YEAR,
          nominalDurationSeconds: 7 * YEAR,
          speedOptions: null,
          fundingPayments: null,
        }),
      ]);

      await waitFor(() => {
        expect(visibleText()).toMatch(/7y/);
      });
      expect(visibleText()).not.toMatch(/24y/);
    } finally {
      setKspCalendar(original);
    }
  });

  /*
   * The accept control, and the whole reason it is here: `rp1.strategy.activate`
   * was declared, handled and reachable from nothing at all.
   *
   * <para>The price is CONFIDENCE and it is charged in full by
   * `Program.Accept()`, so this is an up-front purchase. Funds run the other
   * way: a Program pays the career. Both balances are already at the head of
   * this section, which is what satisfies the spend rule.</para>
   */
  it("offers no accept control on a Program that is not an offer", async () => {
    const { fixture } = mount();
    await feed(fixture);

    expect(visibleText()).not.toContain("ACCEPT");
    expect(screen.queryByRole("button", { name: /^accept/i })).toBeNull();
  });

  it("prices an offerable Program in Confidence, at the speed RP-1 has selected", async () => {
    const { fixture } = mount();
    await feed(fixture, [
      program({
        state: "offerable",
        canAccept: true,
        acceptedUt: null,
        fundsPaidOut: null,
        fundsRemaining: null,
      }),
    ]);

    expect(await screen.findByText("ACCEPT")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /accept x-plane research/i,
    });
    expect(button).toBeEnabled();
    // 350 Confidence at Normal, which is the row the ladder marks SELECTED.
    expect(visibleText()).toContain("Normal speed");
  });

  /*
   * Dark on STATE rather than on the press. The Confidence comparison is the
   * half RP-1 leaves to the client, because it makes that check with a
   * broadcast query, and `ProgramStrategy.CanActivate` asks it again at the
   * press so a stale view cannot spend anything.
   */
  it("refuses on state when the career is short of the Confidence", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({ state: "offerable", canAccept: true, confidenceCost: 900 }),
    ]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.programFundingCurves", [flatCurve()]);
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });
    fixture.emit("career.status", { economy: { funds: 289_848 } });

    await waitFor(() => {
      expect(screen.getByText("ACCEPT")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeDisabled();
  });

  /*
   * The house rule on status badges, ruled on by the operator off a render of
   * this very pane: "status badges ideally should always be above, or aligned
   * to the right. Badge then title doesn't read well because the state comes
   * before the subject."
   *
   * Asserted as DOM ORDER rather than as a class or a style, because order is
   * exactly what "reads before" means to a screen reader walking the heading
   * and to an eye scanning it, and it is the only half of the arrangement that
   * survives every breakpoint the pane reflows through.
   */
  it("names the Program before its state badge", async () => {
    const { fixture } = mount();
    await feed(fixture);

    const catalogue = screen.getByRole("group", { name: "Program catalogue" });
    const heading = screen
      .getAllByText("X-Plane Research")
      .find((node) => !catalogue.contains(node));
    expect(heading).toBeDefined();

    // The whole heading line, both halves of it, in the order they are read.
    expect(heading?.parentElement?.textContent).toBe("X-Plane ResearchACTIVE");
  });

  /**
   * The filter is the case this surface actually serves. Stock KSP's
   * Administration screen carries no search because it offers a handful of
   * strategies; RP-1 publishes tens of Programs into the same list, and it is
   * RP-1 this was built for.
   */
  describe("catalogue filter", () => {
    async function feedThree(fixture: ReturnType<typeof mount>["fixture"]) {
      await feed(fixture, [
        program({
          name: "Aeronautics",
          title: "Aeronautics",
          state: "locked",
          objectivesText: "Break the sound barrier.",
        }),
        program({
          name: "CrewedOrbital",
          title: "Crewed Orbital Program",
          state: "offerable",
        }),
        program(),
      ]);
    }

    function filterBox() {
      return screen.getByRole("searchbox", { name: /Filter Programs/i });
    }

    function catalogue() {
      return screen.getByRole("group", { name: "Program catalogue" });
    }

    it("narrows the catalogue to the Programs whose name matches", async () => {
      const { fixture } = mount();
      await feedThree(fixture);

      await userEvent.type(filterBox(), "aero");

      expect(
        within(catalogue()).getByRole("button", { name: /Aeronautics/ }),
      ).toBeInTheDocument();
      expect(
        within(catalogue()).queryByRole("button", { name: /X-Plane Research/ }),
      ).toBeNull();
    });

    /*
     * The operator asked for a "filter search", so the box takes text. State
     * rides in the same needle rather than arriving as a second control: each
     * row's searchable text carries the word its own badge shows, so "locked"
     * narrows to the locked Programs without a row of chrome above a list that
     * is already capped at 16rem.
     */
    it("matches on the state a row shows as well as on its name", async () => {
      const { fixture } = mount();
      await feedThree(fixture);

      await userEvent.type(filterBox(), "offerable");

      expect(
        within(catalogue()).getByRole("button", {
          name: /Crewed Orbital Program/,
        }),
      ).toBeInTheDocument();
      expect(
        within(catalogue()).queryByRole("button", { name: /Aeronautics/ }),
      ).toBeNull();
    });

    /*
     * Filtering narrows what is on OFFER, never what is being read. A filter
     * that silently moved the detail pane would answer a question about one
     * Program with the readings of another, which is worse than showing
     * nothing.
     */
    it("keeps the detail on the picked Program when the filter hides its row", async () => {
      const { fixture } = mount();
      await feedThree(fixture);

      await userEvent.click(
        await screen.findByRole("button", { name: /Aeronautics LOCKED/ }),
      );
      expect(screen.getByText("Break the sound barrier.")).toBeInTheDocument();

      await userEvent.type(filterBox(), "x-plane");

      expect(
        within(catalogue()).queryByRole("button", { name: /Aeronautics/ }),
      ).toBeNull();
      // Still the pane's subject, and still its readings.
      expect(screen.getByText("Break the sound barrier.")).toBeInTheDocument();
    });

    /* An absence marker, not a paragraph: that the filter matched nothing is a
       reading, and the operator can already see what they typed. */
    it("marks an empty result rather than drawing an empty list", async () => {
      const { fixture } = mount();
      await feedThree(fixture);

      await userEvent.type(filterBox(), "zzz");

      expect(
        screen.getByText("No Program matches the filter"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Program catalogue" }),
      ).toBeNull();
    });

    it("has no accessibility violations with the filter narrowing the list", async () => {
      const { fixture, view } = mount();
      await feedThree(fixture);

      await userEvent.type(filterBox(), "aero");
      await expectNoA11yViolations(view.container);
    });
  });

  it("says so plainly before any catalogue has arrived", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);

    await waitFor(() => {
      expect(
        screen.getByText("RP-1 has not sent a Program catalogue"),
      ).toBeInTheDocument();
    });
    /*
     * The async settle after the body: the stream fixture answers the remaining
     * subscriptions on a later microtask, and without holding the scope open the
     * resulting render lands outside act.
     */
    await act(async () => {});
  });
});
