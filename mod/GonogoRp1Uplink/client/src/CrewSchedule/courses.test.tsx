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
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { TrainingCourses } from "./courses";
import {
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
} from "./training";

const NAUT = "Ludrey Kerman";
const MATE = "Nedcas Kerman";

const TOPICS = [
  "rp1.available",
  "rp1.crew",
  "rp1.training",
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
];

/** One live course, with a second student on it by default. */
function course(overrides: Record<string, unknown> = {}) {
  return {
    completed: false,
    completesAtUt: 6_184_000,
    id: "prof_Mercury-Redstone",
    isTemporary: false,
    name: "Proficiency: Mercury-Redstone",
    seatMax: 4,
    seatMin: 1,
    started: true,
    students: [NAUT, MATE],
    studentsAvailableAtUt: 6_800_000,
    target: "Mercury-Redstone",
    type: "Proficiency",
    ...overrides,
  };
}

/** The crew row RP-1 publishes for a student, which is where the fraction rides. */
function studentRow(name: string, overrides: Record<string, unknown> = {}) {
  return {
    latestRetiresAtUt: 400_000_000,
    name,
    retired: false,
    retiresAtUt: 200_000_000,
    trainingFractionComplete: 0.62,
    trainingStarted: true,
    trainingTarget: "Mercury-Redstone",
    trainingType: "Proficiency",
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <TrainingCourses />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** RP-1 present, with whatever courses and crew rows the test wants. */
function present(
  fixture: ReturnType<typeof setupStreamFixture>,
  courses: Record<string, unknown>[],
  crew: Record<string, unknown>[] = [studentRow(NAUT), studentRow(MATE)],
) {
  act(() => {
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", crew);
    fixture.emit("rp1.training", courses);
  });
}

describe("TrainingCourses", () => {
  it("renders nothing on a stock game", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    /* Settle before asserting ABSENCE. There is no positive signal to wait for
       when the expectation is that nothing renders, so without this the
       assertion can run before the emit has been processed and pass because the
       render had not happened yet rather than because it must not. */
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  /**
   * Most of a career runs no course at all, and a section titled TRAINING
   * COURSES with nothing under it is a row of chrome saying nothing.
   */
  it("renders nothing while the career is running no course", async () => {
    const { fixture, view } = mount();
    present(fixture, []);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.training")).toBe(true);
    });
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows a running course with its kind, progress and finish date", async () => {
    const { fixture, view } = mount();
    present(fixture, [course()]);

    await waitFor(() => {
      expect(visibleText()).toContain("Proficiency: Mercury-Redstone");
    });
    const text = visibleText();
    expect(text).toContain("TRAINING");
    /* Each reading names itself now rather than riding in one sentence, so the
       labels are the assertion: a percentage and two dates in a row could only
       be told apart by the order they happened to be in. */
    expect(text).toContain("Progress");
    expect(text).toContain("62");
    expect(text).toContain("Finishes");
    expect(text).toContain("Crew free");
    expect(text).toContain("Students");
    await expectNoA11yViolations(view.container);
  });

  /**
   * "Mission" is the name of a KIND OF TRAINING in RP-1, not of a flight:
   * `TrainingTemplate.TrainingType` has two members and this is the second.
   * Rendered raw beside a date it reads as a mission lasting thirty days.
   */
  it("says mission TRAINING rather than RP-1's bare enum", async () => {
    const { fixture } = mount();
    present(
      fixture,
      [course({ id: "msn_Gemini", target: "Gemini", type: "Mission" })],
      [
        studentRow(NAUT, { trainingType: "Mission" }),
        studentRow(MATE, { trainingType: "Mission" }),
      ],
    );

    await waitFor(() => {
      expect(visibleText()).toContain("Mission training: Gemini");
    });
  });

  /**
   * RP-1 lets a course sit unstarted indefinitely, and an operator who reads
   * enrolment as progress will plan a flight around a crew nobody is training.
   */
  it("tells an enrolled course from a running one", async () => {
    const { fixture } = mount();
    present(fixture, [course({ started: false })]);

    await waitFor(() => {
      expect(screen.getByText("NOT STARTED")).toBeInTheDocument();
    });
    expect(screen.queryByText("TRAINING")).not.toBeInTheDocument();
  });

  /** Cancelling takes every one of them off, so every one of them is named. */
  it("names the students on the course", async () => {
    const { fixture } = mount();
    present(fixture, [course()]);

    await waitFor(() => {
      expect(visibleText()).toContain(`${NAUT}, ${MATE}`);
    });
  });

  /**
   * The date the course finishes is NOT the date its crew can fly: RP-1 grounds
   * each student for 120% of the course's length from the moment it starts, so
   * the date a flight gets planned against is the later one.
   */
  it("states when the crew comes free, which is after the course ends", async () => {
    const { fixture } = mount();
    present(fixture, [course()]);

    await waitFor(() => {
      expect(visibleText()).toContain("Crew free");
    });
  });

  /** A course that has finished is not a course anybody is on. */
  it("does not list a completed course", async () => {
    const { fixture, view } = mount();
    present(fixture, [course({ completed: true })]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.training")).toBe(true);
    });
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  /**
   * ONE cancel for one course, where a control on each student's roster row
   * drew the same act once per student. RP-1 addresses a course by one of its
   * students, so that is what the command carries.
   */
  it("cancels the whole course once, naming how many come off it", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();
    present(fixture, [course()]);

    const control = await screen.findByRole("button", {
      name: "Cancel this course",
    });
    await user.click(control);
    // Armed, not sent: a cancelled course credits nobody, so one press must not
    // commit it.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_CANCEL_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", { name: "Confirm cancelling this course" }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_CANCEL_COMMAND,
      )?.args,
    ).toEqual({ crewName: NAUT });
    // The count is on the confirm, which is where it decides anything.
    expect(
      screen.queryAllByRole("button", { name: "Cancel this course" }),
    ).toHaveLength(1);
    await expectNoA11yViolations(view.container);
  });

  it("takes one named student off a course the rest can carry on", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    present(fixture, [course()]);

    await user.click(
      await screen.findByRole("button", {
        name: `Take ${MATE} off the course`,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: `Confirm taking ${MATE} off the course`,
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_REMOVE_COMMAND,
      )?.args,
    ).toEqual({ crewName: MATE });
  });

  /**
   * RP-1 expresses this refusal by not drawing the button at all: taking one
   * student out of a course that needs two strands the rest below its minimum.
   */
  it("darkens the removal on a course that needs more than one student", async () => {
    const { fixture } = mount();
    present(fixture, [course({ seatMin: 2 })]);

    const control = await screen.findByRole("button", {
      name: `${NAUT} off`,
    });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "This course seats 2 at least, so one student cannot leave it",
    );
    // Cancelling the whole course is the way out RP-1 leaves open here.
    expect(
      screen.getByRole("button", { name: "Cancel this course" }),
    ).toBeEnabled();
    /* Same control as the press, and the same chrome with it. Its name drops to
       the visible label, where the pressable one says "off the course": a
       refusal announcing the act would describe something that cannot happen. */
    expect(control).toHaveAttribute("data-command-phase", "idle");
    expect(control).toHaveAccessibleName(`${NAUT} off`);
  });

  it("registers itself into the Astronaut Complex training tab", () => {
    const augments = getAugmentsForSlot("astronaut-complex.training");
    expect(augments.map((a) => a.id)).toContain("rp1-training-courses");
  });
});
