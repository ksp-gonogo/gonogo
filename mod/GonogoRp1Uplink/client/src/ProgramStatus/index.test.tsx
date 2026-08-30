import {
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ProgramStatus } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.programs",
  "rp1.programSlots",
  "rp1.confidence",
];

function program(overrides: Record<string, unknown> = {}) {
  return {
    name: "EarlyXPlanes",
    title: "X-Plane Research",
    state: "active",
    speed: "Normal",
    slots: 2,
    isHumanSpaceflight: true,
    nominalDurationSeconds: 9 * 31_557_600,
    acceptedUt: 1_000,
    deadlineUt: 285_000_000,
    objectivesCompletedUt: null,
    completedUt: null,
    lastPaymentUt: 40_000,
    fracElapsed: 0.25,
    totalFunding: 800_000,
    fundsPaidOut: 120_000,
    fundsRemaining: 680_000,
    fundingCurve: "BimodalBackloaded",
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

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <ProgramStatus />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("ProgramStatus", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("says a career with nothing running is on the subsidy alone", async () => {
    // The state the live career is actually in, and the one the operator has no
    // other way to learn: money arrives, and it is all floor.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", []);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 0, freeSlots: 3 }));
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText(/Subsidy only/)).toBeInTheDocument();
    });
  });

  it("shows a running Program's draw-down, deadline and slot commitment", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [program()]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("X-Plane Research")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("120,000");
    expect(text).toContain("800,000");
    expect(
      screen.getByRole("progressbar", {
        name: /Program funding drawn down, X-Plane Research/,
      }),
    ).toHaveAttribute("aria-valuenow", "25");
    await expectNoA11yViolations(view.container);
  });

  it("warns once a Program has overrun and says what the overrun has cost", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({ fracElapsed: 1.4, repPenaltyAssessed: 52 }),
    ]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("OVERRUN")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("Overrun cost");
  });

  it("keeps quiet about the overrun rate while the Program is still inside its deadline", async () => {
    // Before the deadline nothing is charging it, and printing the rate reads
    // as a loss already taken.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [program()]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("X-Plane Research")).toBeInTheDocument();
    });
    expect(screen.queryByText("Overrun cost")).not.toBeInTheDocument();
    expect(screen.queryByText("OVERRUN")).not.toBeInTheDocument();
  });

  it("marks a Program whose objectives are done as ready to complete", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({ objectivesMet: true, canComplete: true }),
    ]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("READY TO COMPLETE")).toBeInTheDocument();
    });
  });

  it("lists what could be accepted now with its price in both currencies", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({
        name: "EarlySatellites",
        title: "Early Satellites",
        state: "offerable",
        acceptedUt: null,
        deadlineUt: null,
        lastPaymentUt: null,
        fracElapsed: null,
        fundsPaidOut: null,
        fundsRemaining: null,
        repPenaltyAssessed: null,
        canAccept: true,
        totalFunding: 350_000,
        confidenceCost: 250,
      }),
    ]);
    fixture.emit("rp1.programSlots", slots());
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("Early Satellites")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("Acceptable now");
    expect(text).toContain("350,000");
    expect(text).toContain("250");
  });

  it("does not offer a locked or disabled Program as acceptable", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({ name: "CrewedOrbit", title: "Crewed Orbit", state: "locked" }),
      program({
        name: "CrewedOrbitEarly",
        title: "Crewed Orbit (Early)",
        state: "disabled",
      }),
    ]);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 0, freeSlots: 3 }));
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText(/Subsidy only/)).toBeInTheDocument();
    });
    expect(screen.queryByText("Acceptable now")).not.toBeInTheDocument();
    expect(screen.queryByText("Crewed Orbit")).not.toBeInTheDocument();
  });

  it("flags a full slate, and stays quiet when the ceiling is unknown", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [program()]);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 3, freeSlots: 0 }));
    fixture.emit("rp1.confidence", { confidence: 500, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("FULL")).toBeInTheDocument();
    });

    /*
     * An unknown ceiling is not a full one: outside a loaded career RP-1 cannot
     * answer it, and a FULL badge there would tell the operator they cannot
     * start something when nobody knows.
     */
    fixture.emit(
      "rp1.programSlots",
      slots({ maxSlots: null, freeSlots: null, usedSlots: 3 }),
    );
    await waitFor(() => {
      expect(screen.queryByText("FULL")).not.toBeInTheDocument();
    });
  });

  it("shows the Confidence balance beside the prices it is spent on", async () => {
    /*
     * Accepting a Program is the only thing in RP-1 that spends Confidence, so
     * this is the widget the repo's spend rule binds: a price the operator has
     * to leave the screen to weigh is a price they weigh wrong.
     */
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", []);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 0, freeSlots: 3 }));
    fixture.emit("rp1.confidence", { confidence: 350, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("Confidence")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("350");
  });

  it("marks an offer the career cannot afford, and only when both halves are known", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({
        name: "EarlySatellites",
        title: "Early Satellites",
        state: "offerable",
        acceptedUt: null,
        deadlineUt: null,
        lastPaymentUt: null,
        fracElapsed: null,
        fundsPaidOut: null,
        fundsRemaining: null,
        repPenaltyAssessed: null,
        canAccept: true,
        confidenceCost: 600,
      }),
    ]);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 0, freeSlots: 3 }));
    fixture.emit("rp1.confidence", { confidence: 350, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("SHORT")).toBeInTheDocument();
    });

    // An unknown balance is not a short one. RP-1's Confidence module can be
    // absent entirely, and a SHORT badge there accuses the career of something
    // nobody measured.
    fixture.emit("rp1.confidence", { confidence: null, earned: null });
    await waitFor(() => {
      expect(screen.queryByText("SHORT")).not.toBeInTheDocument();
    });
  });

  it("does not call an affordable offer short, including at exactly the price", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.programs", [
      program({
        name: "EarlySatellites",
        title: "Early Satellites",
        state: "offerable",
        acceptedUt: null,
        deadlineUt: null,
        lastPaymentUt: null,
        fracElapsed: null,
        fundsPaidOut: null,
        fundsRemaining: null,
        repPenaltyAssessed: null,
        canAccept: true,
        confidenceCost: 350,
      }),
    ]);
    fixture.emit("rp1.programSlots", slots({ usedSlots: 0, freeSlots: 3 }));
    fixture.emit("rp1.confidence", { confidence: 350, earned: 0 });

    await waitFor(() => {
      expect(screen.getByText("Early Satellites")).toBeInTheDocument();
    });
    // Exactly enough IS enough: RP-1 charges the price and leaves zero.
    expect(screen.queryByText("SHORT")).not.toBeInTheDocument();
  });

  it("registers itself into the funding widget's universal sections segment", () => {
    // Beside the subsidy, which is the other half of the same income and the
    // half that widget already knew about.
    const augments = getAugmentsForSlot("career-economy.sections");
    expect(augments.map((a) => a.id)).toContain("rp1-program-status");
  });
});
