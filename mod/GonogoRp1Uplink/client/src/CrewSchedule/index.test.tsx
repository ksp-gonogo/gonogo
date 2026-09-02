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
  /* Subscribe BEFORE emitting. `StubTransport.emit` is subscription-gated and
     drops the payload silently when nothing has subscribed yet, and a widget
     subscribes in an effect that has not run when `render()` returns. So these
     emits were being discarded and the enrolment control read its channels as
     unread, which is what the emptiness assertions here were racing: the control
     rendered "Training catalogue unread" wherever a frame happened to land
     before they ran. */
  fixture.subscribe("rp1.trainingCatalogue");
  fixture.subscribe("spaceCenter.crewRoster");
  fixture.subscribe("rp1.training");
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

describe("CrewSchedule", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    /* Mint a frame before asserting ABSENCE. An emit alone does not make a
       reading readable: `current()` returns undefined until the reading is
       `observed` or `reckonable`, and the frame that gets it there is normally
       an animation frame off `ViewClock.onFrame`. That is timing, so the
       assertion passed locally where the frame had not landed and failed on CI
       where it had, with the enrolment control reporting an unread channel.
       `beginFrame` applies it deterministically, as the fixture's own doc says. */
    act(() => {
      fixture.store.beginFrame();
    });
    await act(async () => {});
    /* The operator sees nothing, which is not the same as the DOM being
       empty: the section still renders its structural wrappers. Assert on
       visible text, which is the claim these tests are actually making. */
    expect(visibleText(view.container)).toBe("");
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
    /* Mint a frame before asserting ABSENCE. An emit alone does not make a
       reading readable: `current()` returns undefined until the reading is
       `observed` or `reckonable`, and the frame that gets it there is normally
       an animation frame off `ViewClock.onFrame`. That is timing, so the
       assertion passed locally where the frame had not landed and failed on CI
       where it had, with the enrolment control reporting an unread channel.
       `beginFrame` applies it deterministically, as the fixture's own doc says. */
    act(() => {
      fixture.store.beginFrame();
    });
    await act(async () => {});
    /* The operator sees nothing, which is not the same as the DOM being
       empty: the section still renders its structural wrappers. Assert on
       visible text, which is the claim these tests are actually making. */
    expect(visibleText(view.container)).toBe("");
  });

  it("names what pushes the retirement date, not a control that pushes it", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(visibleText()).toContain("Retires");
    });
    // The ceiling is what makes the date actionable, so it is on screen rather
    // than only in a tooltip. It names its two causes with it: "extendable to"
    // read as an offer, and an operator went looking for the button. There is
    // none, in RP-1 or here, and the two things that DO move the date are a
    // completed course and a recovered crewed flight.
    expect(visibleText()).toContain(
      "flights and completed training push this to",
    );
    expect(visibleText()).not.toContain("extendable");
    await expectNoA11yViolations(view.container);
  });

  /**
   * A kerbal whose extension cap is spent has a ceiling equal to their date.
   * Quoting a ceiling equal to the date would tell an operator it can still move
   * when it cannot.
   */
  it("says nothing about pushing a retirement that cannot be pushed further", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", [crewRow({ latestRetiresAtUt: RETIRES_AT })]);

    await waitFor(() => {
      expect(visibleText()).toContain("Retires");
    });
    expect(visibleText()).not.toContain("push this to");
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
    /* Mint a frame before asserting ABSENCE. An emit alone does not make a
       reading readable: `current()` returns undefined until the reading is
       `observed` or `reckonable`, and the frame that gets it there is normally
       an animation frame off `ViewClock.onFrame`. That is timing, so the
       assertion passed locally where the frame had not landed and failed on CI
       where it had, with the enrolment control reporting an unread channel.
       `beginFrame` applies it deterministically, as the fixture's own doc says. */
    act(() => {
      fixture.store.beginFrame();
    });
    await act(async () => {});
    /* The operator sees nothing, which is not the same as the DOM being
       empty: the section still renders its structural wrappers. Assert on
       visible text, which is the claim these tests are actually making. */
    expect(visibleText(view.container)).toBe("");
  });

  /**
   * The setting is HONOURED, not reported. Retirement switched off means the
   * concept is absent from the save, so it is absent from the surface: not an
   * empty cell, not a line saying retirement is off, and not the word anywhere.
   */
  it("says nothing whatever about retirement on a save that has it off", async () => {
    const { fixture, view } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", { ...PROGRAM, retirementEnabled: false });
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crewProgram")).toBe(true);
    });
    /* Mint a frame before asserting ABSENCE. An emit alone does not make a
       reading readable: `current()` returns undefined until the reading is
       `observed` or `reckonable`, and the frame that gets it there is normally
       an animation frame off `ViewClock.onFrame`. That is timing, so the
       assertion passed locally where the frame had not landed and failed on CI
       where it had, with the enrolment control reporting an unread channel.
       `beginFrame` applies it deterministically, as the fixture's own doc says. */
    act(() => {
      fixture.store.beginFrame();
    });
    await act(async () => {});
    /* The operator sees nothing, which is not the same as the DOM being
       empty: the section still renders its structural wrappers. Assert on
       visible text, which is the claim these tests are actually making. */
    expect(visibleText(view.container)).toBe("");
    // The stem, so "Retires", "retirement" and "retiree" all fail it.
    expect(view.container.textContent ?? "").not.toMatch(/retir/i);
  });

  /**
   * A kerbal with a course AND a lapse, on a save with mission training off:
   * the course still reads, because a proficiency runs regardless, and the
   * lapse does not, because RP-1 stops checking mission training entirely
   * (`CheckCrewForPart` returns true without asking). A deadline nothing will
   * enforce is worse than no deadline.
   */
  it("drops a mission-training lapse the save will never check", async () => {
    const { fixture } = mountSchedule();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", {
      ...PROGRAM,
      missionTrainingEnabled: false,
    });
    fixture.emit("rp1.crew", [
      crewRow({
        nextTrainingExpiryTarget: "Atlas-D",
        nextTrainingExpiryUt: LAPSES_AT,
        trainingStarted: true,
        trainingTarget: "Mercury-Redstone",
        trainingType: "Proficiency",
      }),
    ]);

    // The course line is the positive signal that the row rendered at all, so
    // the lapse assertion is about a fact that was read and dropped.
    await waitFor(() => {
      expect(visibleText()).toContain("Proficiency: Mercury-Redstone");
    });
    /* The LABEL, capitalised as the DOM carries it: the line names itself
       "Lapses" and the word no longer appears in the reading beside it, so a
       lowercase "lapses" here would match nothing whatever the widget drew and
       pass on a lapse line that had rendered in full. */
    expect(visibleText()).not.toContain("Lapses");
  });

  /**
   * WHICH course, not how it is going. The percentage, the finish date and the
   * two ways off it belong to the course and are drawn once on it; drawn here
   * they appeared once per student on a course two kerbals share.
   */
  it("names the course a kerbal is on, and none of its specifics", async () => {
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
    expect(text).toContain("Mission training: Mun");
    expect(text).not.toContain("finishes");
    expect(text).not.toContain("25");
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
      expect(visibleText()).toContain("Mission training for Minmus");
    });
    // The line names itself, so the kind and the target are the reading.
    expect(visibleText()).toContain("Lapses");
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
      expect(visibleText()).toContain("Mission training for Minmus");
    });
    expect(visibleText()).toContain("Lapses");
    expect(visibleText()).not.toContain("more");
  });

  it("registers itself into the Astronaut Complex's per-crew slot", () => {
    const augments = getAugmentsForSlot("astronaut-complex.crew");
    expect(augments.map((a) => a.id)).toContain("rp1-crew-schedule");
  });
});
