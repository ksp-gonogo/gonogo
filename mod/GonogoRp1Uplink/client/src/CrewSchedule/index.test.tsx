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
import { act } from "react";
import { describe, expect, it } from "vitest";
import { CrewSchedule } from "./index";
import { CrewProgramme } from "./programme";

const TOPICS = ["rp1.available", "rp1.crew", "rp1.crewProgram"];

// Year 1 day 1 in KSP's calendar is UT 0, so these are deliberately far apart
// enough that two rendered dates can never collide in an assertion.
const RETIRES_AT = 200_000_000;
const LATEST_RETIRES_AT = 400_000_000;
const FINISHES_AT = 5_000_000;
const LAPSES_AT = 9_000_000;

function crewRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Wernher Kerman",
    retired: false,
    retiresAtUt: RETIRES_AT,
    latestRetiresAtUt: LATEST_RETIRES_AT,
    retirementExtensionUsedSeconds: 0,
    trainingCourse: null,
    trainingType: null,
    trainingTarget: null,
    trainingStarted: null,
    trainingFractionComplete: null,
    trainingFinishesAtUt: null,
    nextTrainingExpiryUt: null,
    nextTrainingExpiryTarget: null,
    trainingExpiryCount: 0,
    ...overrides,
  };
}

const PROGRAM = {
  retirementEnabled: true,
  crewRnREnabled: true,
  missionTrainingEnabled: true,
  proficiencyTrainingRate: 1,
  missionTrainingRate: 1,
  retirementExtensionCapSeconds: 473_040_000,
  courses: 1,
  coursesStarted: 1,
  crewInTraining: 1,
};

function mountSchedule(kerbalName = "Wernher Kerman") {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <CrewSchedule kerbalName={kerbalName} />
    </fixture.Provider>,
  );
  /* An EMPTY catalogue, not an absent one, so a test that says nothing about
     training still leaves that channel READ. The enrolment control reports an
     unread catalogue in one short line, which is correct for an unreadable
     state and is exactly what five `toBeEmptyDOMElement` assertions here were
     unknowingly racing: green locally where the control had not rendered by the
     time they ran, red on CI where it had. A test that does not care about a
     channel should still feed it. */
  fixture.emit("rp1.trainingCatalogue", []);
  /* The enrolment control reads FIVE channels and reports an unread one in a
     short line, which is correct for an unreadable state and is what the
     emptiness assertions here were racing. Feeding the catalogue alone left four
     unfed, so the race survived: green locally where the control had not
     rendered by the time the assertion ran, red on CI where it had. Feed every
     channel the control reads, not just the one that was noticed first. */
  fixture.emit("spaceCenter.crewRoster", []);
  fixture.emit("rp1.training", []);
  return { fixture, view };
}

function mountProgramme() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <CrewProgramme />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("CrewSchedule", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait
       for when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because
       the render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  /**
   * A kerbal RP-1 has no record of is not a kerbal with an unknown schedule: it
   * is a kerbal RP-1 is not scheduling. Rendering a row of dashes for them
   * would say the dates are missing where the truth is that they do not exist.
   */
  it("renders nothing for a kerbal RP-1 is not scheduling", async () => {
    const { fixture, view } = mountSchedule("Jebediah Kerman");
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crew")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait
       for when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because
       the render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the retirement date and how far it can still be pushed", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(visibleText()).toContain("Retires");
    });
    // The ceiling is what makes the date actionable, so it is on screen rather
    // than only in a tooltip.
    expect(visibleText()).toContain("extendable to");
    await expectNoA11yViolations(view.container);
  });

  /**
   * A kerbal whose extension cap is spent has a ceiling equal to their date.
   * Quoting "extendable to <the same date>" would tell an operator the date can
   * move when it cannot.
   */
  it("says nothing about extending a retirement that cannot be pushed further", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [crewRow({ latestRetiresAtUt: RETIRES_AT })]);

    await waitFor(() => {
      expect(visibleText()).toContain("Retires");
    });
    expect(visibleText()).not.toContain("extendable");
  });

  /**
   * RP-1's own getter answers 0 for a kerbal it holds no retirement date for,
   * and the mod side turns that into an absence. A kerbal whose retirement date
   * is unknown is not a kerbal retiring at UT zero, so nothing is quoted.
   */
  it("quotes no retirement date when RP-1 holds none", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [
      crewRow({ retiresAtUt: null, latestRetiresAtUt: null }),
    ]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crew")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait
       for when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because
       the render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  /**
   * A date nothing will act on is worse than no date: an operator planning
   * around a retirement that the save has switched off is planning around
   * nothing.
   */
  it("hides the retirement date on a save where retirement is switched off", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", { ...PROGRAM, retirementEnabled: false });
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crewProgram")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait
       for when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because
       the render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows a running course with its progress and finish date", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_mission-Mun",
        trainingType: "Mission",
        trainingTarget: "Mun",
        trainingStarted: true,
        trainingFractionComplete: 0.25,
        trainingFinishesAtUt: FINISHES_AT,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("TRAINING")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("Mission: Mun");
    expect(text).toContain("finishes");
    await expectNoA11yViolations(view.container);
  });

  /**
   * Enrolment and progress are separate facts. RP-1 lets a course sit unstarted
   * indefinitely, and an operator who reads enrolment as progress will plan a
   * mission around a crew that is not being trained.
   */
  it("distinguishes an enrolled course from a running one", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_proficiency-LR79",
        trainingType: "Proficiency",
        trainingTarget: "LR79",
        trainingStarted: false,
        trainingFinishesAtUt: null,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("ENROLLED")).toBeInTheDocument();
    });
    expect(screen.queryByText("TRAINING")).not.toBeInTheDocument();
    // And no finish date, because there is none: an unstarted course makes no
    // progress, and RP-1's own helper would divide by an unrated rate.
    expect(visibleText()).not.toContain("finishes");
  });

  it("names the soonest lapsing training and how many are behind it", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [
      crewRow({
        nextTrainingExpiryUt: LAPSES_AT,
        nextTrainingExpiryTarget: "Minmus",
        trainingExpiryCount: 3,
      }),
    ]);

    await waitFor(() => {
      expect(visibleText()).toContain("Minmus training lapses");
    });
    expect(visibleText()).toContain("+2 more");
  });

  it("says nothing about extra lapses when there is only one", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [
      crewRow({
        nextTrainingExpiryUt: LAPSES_AT,
        nextTrainingExpiryTarget: "Minmus",
        trainingExpiryCount: 1,
      }),
    ]);

    await waitFor(() => {
      expect(visibleText()).toContain("Minmus training lapses");
    });
    expect(visibleText()).not.toContain("more");
  });

  it("registers itself into the Astronaut Complex's per-crew slot", () => {
    const augments = getAugmentsForSlot("astronaut-complex.crew");
    expect(augments.map((a) => a.id)).toContain("rp1-crew-schedule");
  });
});

describe("CrewProgramme", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mountProgramme();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait
       for when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because
       the render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the switches and rates every per-kerbal date depends on", async () => {
    const { fixture, view } = mountProgramme();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);

    await waitFor(() => {
      expect(screen.getByText("Retirement")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("Post-flight R&R");
    expect(text).toContain("Mission training");
    expect(text).toContain("Proficiency rate");
    await expectNoA11yViolations(view.container);
  });

  /**
   * A switch nobody could read is not a switch that is off. Reading an absent
   * flag as "Off" would say retirement is disabled on a career that retires
   * people, which is the same class of mistake as reading an absent date as a
   * date.
   */
  it("shows an unread switch as absent rather than as off", async () => {
    const { fixture } = mountProgramme();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", { ...PROGRAM, retirementEnabled: null });

    await waitFor(() => {
      expect(screen.getByText("Retirement")).toBeInTheDocument();
    });
    const row = screen.getByText("Retirement").closest("li") as HTMLElement;
    expect(row.textContent).not.toContain("Off");
  });

  /**
   * Progress nobody is making. A course enrolled but not started is the state
   * an operator has to notice, because nothing else on the dashboard says the
   * training queue has stalled.
   */
  it("flags courses that are enrolled but not started", async () => {
    const { fixture } = mountProgramme();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", {
      ...PROGRAM,
      courses: 3,
      coursesStarted: 1,
    });

    await waitFor(() => {
      expect(screen.getByText("NOT STARTED")).toBeInTheDocument();
    });
  });

  it("does not flag when every course has begun", async () => {
    const { fixture } = mountProgramme();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", {
      ...PROGRAM,
      courses: 2,
      coursesStarted: 2,
    });

    await waitFor(() => {
      expect(screen.getByText("In training")).toBeInTheDocument();
    });
    expect(screen.queryByText("NOT STARTED")).not.toBeInTheDocument();
  });

  it("registers itself into the Astronaut Complex's sections slot", () => {
    const augments = getAugmentsForSlot("astronaut-complex.sections");
    expect(augments.map((a) => a.id)).toContain("rp1-crew-programme");
  });
});
