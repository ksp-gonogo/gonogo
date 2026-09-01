import {
  act,
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
import { describe, expect, it } from "vitest";
import { CrewSchedule } from "./index";
import {
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_ENROL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
} from "./training";

const NAUT = "Ludrey Kerman";

/** An ordinary crewmate, for the scenes where one naut's row must be told from another's. */
const MATE = "Nedcas Kerman";

const TOPICS = [
  "rp1.available",
  "rp1.crew",
  "rp1.crewProgram",
  "rp1.training",
  "rp1.trainingCatalogue",
  RP1_TRAINING_ENROL_COMMAND,
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
];

const PROGRAM = {
  courses: 1,
  coursesStarted: 1,
  crewInTraining: 1,
  crewRnREnabled: true,
  missionTrainingEnabled: true,
  missionTrainingRate: 1,
  proficiencyTrainingRate: 1,
  retirementEnabled: true,
  retirementExtensionCapSeconds: 473_040_000,
};

/** A training one kerbal can be put through on their own. */
const SOLO = {
  baseTime: 1_296_000,
  id: "tt-mercury",
  isTemporary: false,
  name: "Mercury-Redstone",
  seatMax: 4,
  seatMin: 1,
  target: "Mercury-Redstone",
  type: "Proficiency",
  unlocked: true,
};

/** A training RP-1 will not run below two students, which a row cannot fill. */
const PAIR = {
  baseTime: 2_592_000,
  id: "tt-gemini",
  isTemporary: false,
  name: "Gemini",
  seatMax: 2,
  seatMin: 2,
  target: "Gemini",
  type: "Mission",
  unlocked: true,
};

/** A training whose parts the career has not researched. */
const LOCKED = {
  baseTime: 5_184_000,
  id: "tt-saturn",
  isTemporary: false,
  name: "Saturn V",
  seatMax: 3,
  seatMin: 1,
  target: "Saturn V",
  type: "Proficiency",
  unlocked: false,
};

function crewRow(overrides: Record<string, unknown> = {}) {
  return {
    latestRetiresAtUt: 400_000_000,
    name: NAUT,
    retired: false,
    retiresAtUt: 200_000_000,
    ...overrides,
  };
}

/** The crew row of a kerbal RP-1 is running a course for. */
function training(overrides: Record<string, unknown> = {}) {
  return crewRow({
    trainingCourse: "tt-mercury",
    trainingFinishesAtUt: 6_184_000,
    trainingFractionComplete: 0.62,
    trainingStarted: true,
    trainingTarget: "Mercury-Redstone",
    trainingType: "Proficiency",
    ...overrides,
  });
}

/** One live course, with a second student on it by default. */
function course(overrides: Record<string, unknown> = {}) {
  return {
    completed: false,
    completesAtUt: 6_184_000,
    id: "tt-mercury",
    isTemporary: false,
    name: "Mercury-Redstone",
    seatMax: 4,
    seatMin: 1,
    started: true,
    students: [NAUT, "Nedcas Kerman"],
    target: "Mercury-Redstone",
    type: "Proficiency",
    ...overrides,
  };
}

function mount(
  slotProps: Record<string, unknown> = { isApplicant: false, standing: 2 },
) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <CrewSchedule kerbalName={NAUT} {...slotProps} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/**
 * The naut under test beside an ordinary crewmate reading the same catalogue.
 *
 * <para>The control is what makes "no picker for this one" a finding rather
 * than a race: a picker missing because the augment declined to draw one and a
 * picker missing because the catalogue has not landed look identical, and the
 * crewmate's picker only appears once it has.</para>
 */
function mountBeside(slotProps: Record<string, unknown>) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <CrewSchedule kerbalName={NAUT} {...slotProps} />
      <CrewSchedule isApplicant={false} kerbalName={MATE} standing={2} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/**
 * RP-1 present, the rules read, one crew row for the naut under test, and then
 * whatever the test wants the training channels to say.
 *
 * <para>Two rounds rather than one, because the controls are what subscribes to
 * the training channels and they are not mounted until RP-1 has answered with a
 * row: a payload emitted before that subscription exists reaches nobody.</para>
 */
async function present(
  fixture: ReturnType<typeof setupStreamFixture>,
  rows: Record<string, unknown>[],
  then: {
    catalogue?: Record<string, unknown>[];
    courses?: Record<string, unknown>[];
  } = {},
) {
  act(() => {
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crewProgram", PROGRAM);
    fixture.emit("rp1.crew", rows);
  });
  await waitFor(() => {
    expect(fixture.transport.isSubscribed("rp1.trainingCatalogue")).toBe(true);
    expect(fixture.transport.isSubscribed("rp1.training")).toBe(true);
  });
  act(() => {
    if (then.courses) {
      fixture.emit("rp1.training", then.courses);
    }
    if (then.catalogue) {
      fixture.emit("rp1.trainingCatalogue", then.catalogue);
    }
  });
}

describe("enrolling", () => {
  it("starts a course for this kerbal in one press pair", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();
    await present(fixture, [crewRow()], { catalogue: [SOLO, PAIR] });

    const control = await screen.findByRole("button", {
      name: `Enrol ${NAUT} on Mercury-Redstone`,
    });
    await user.click(control);
    // Armed, not sent: enrolling grounds the kerbal for the length of the
    // course, so one press must not commit them.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", {
        name: `Confirm enrolling ${NAUT} on Mercury-Redstone`,
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
    );
    // The template AND the crew together, which is the whole press: RP-1 has no
    // enrolled-but-unstarted course to add anybody to afterwards.
    expect(sent?.args).toEqual({ crew: [NAUT], templateId: "tt-mercury" });
    await expectNoA11yViolations(view.container);
  });

  it("enrols on the training the operator picked", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, [crewRow()], { catalogue: [PAIR, SOLO] });

    const picker = await screen.findByRole("combobox", {
      name: `Training for ${NAUT}`,
    });
    await user.selectOptions(picker, "tt-mercury");
    await user.click(
      screen.getByRole("button", { name: `Enrol ${NAUT} on Mercury-Redstone` }),
    );
    await user.click(
      screen.getByRole("button", {
        name: `Confirm enrolling ${NAUT} on Mercury-Redstone`,
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
      )?.args,
    ).toEqual({ crew: [NAUT], templateId: "tt-mercury" });
  });

  /**
   * Enrolling is all-or-none and this control names one kerbal, so a training
   * RP-1 will not run below two students cannot be started from a naut's row.
   * The reason rides the control rather than a paragraph beside it.
   */
  it("refuses a training that seats more than this row can name", async () => {
    const { fixture } = mount();
    await present(fixture, [crewRow()], { catalogue: [PAIR, SOLO] });

    const control = await screen.findByRole("button", { name: "Enrol" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "Gemini needs 2 students and a naut's row enrols one",
    );
    // And the seat bounds are on screen, so the dark control is readable as a
    // consequence of the training rather than of the kerbal.
    expect(visibleText()).toContain("seats 2");
    /* One control for both states, so the refusal cannot be drawn louder than
       the press: the kit's `Button`, which used to carry it, is a font size
       larger and uppercase. `data-command-phase` is what reverting to one
       would lose. The name stays the visible word, with the reason in
       `title`, which is what the disabled `Button` announced. */
    expect(control).toHaveAttribute("data-command-phase", "idle");
    expect(control).toHaveAccessibleName("Enrol");
  });

  /**
   * `rp1.training.enrol` does not ask whether a training is unlocked, because
   * RP-1's own screen answers that by not listing it. Offering one would start
   * a course on hardware the career has not researched.
   */
  it("offers only the trainings the career has unlocked", async () => {
    const { fixture } = mount();
    await present(fixture, [crewRow()], { catalogue: [SOLO, LOCKED] });

    await screen.findByRole("combobox", { name: `Training for ${NAUT}` });
    expect(
      screen.queryByRole("option", { name: "Saturn V" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Mercury-Redstone" }),
    ).toBeInTheDocument();
  });

  /** A catalogue nobody could read is not a career with no trainings in it. */
  it("says the catalogue is unread rather than offering nothing", async () => {
    const { fixture } = mount();
    await present(fixture, [crewRow()]);

    await waitFor(() => {
      expect(visibleText()).toContain("Training catalogue unread");
    });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers no enrolment to an applicant, whom RP-1 will not take", async () => {
    const { fixture, view } = mountBeside({ isApplicant: true, standing: 1 });
    await present(fixture, [crewRow(), crewRow({ name: MATE })], {
      catalogue: [SOLO],
    });

    await screen.findByRole("combobox", { name: `Training for ${MATE}` });
    expect(
      screen.queryByRole("combobox", { name: `Training for ${NAUT}` }),
    ).not.toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("offers no enrolment to a kerbal who is off the books", async () => {
    const { fixture } = mountBeside({ isApplicant: false, standing: 6 });
    await present(
      fixture,
      [crewRow({ retired: true }), crewRow({ name: MATE })],
      { catalogue: [SOLO] },
    );

    await screen.findByRole("combobox", { name: `Training for ${MATE}` });
    expect(
      screen.queryByRole("combobox", { name: `Training for ${NAUT}` }),
    ).not.toBeInTheDocument();
  });
});

describe("leaving a course", () => {
  it("cancels the whole course, naming how many come off it", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();
    await present(fixture, [training()], {
      catalogue: [SOLO],
      courses: [course()],
    });

    // The count is on the resting label, which is what tells this control apart
    // from the one beside it without reading either.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: `Cancel the course ${NAUT} is on` }),
      ).toHaveTextContent("Cancel course, 2 off");
    });
    const control = screen.getByRole("button", {
      name: `Cancel the course ${NAUT} is on`,
    });
    await user.click(control);
    await user.click(
      screen.getByRole("button", {
        name: `Confirm cancelling the course ${NAUT} is on`,
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_CANCEL_COMMAND,
      )?.args,
    ).toEqual({ crewName: NAUT });
    await expectNoA11yViolations(view.container);
  });

  it("takes one student off a course the rest can carry on", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, [training()], {
      catalogue: [SOLO],
      courses: [course()],
    });

    await user.click(
      await screen.findByRole("button", {
        name: `Take ${NAUT} off the course`,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: `Confirm taking ${NAUT} off the course`,
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_REMOVE_COMMAND,
      )?.args,
    ).toEqual({ crewName: NAUT });
  });

  /**
   * RP-1 expresses this refusal by not drawing the button at all: taking one
   * student out of a course that needs two strands the rest below its minimum.
   */
  it("darkens the removal on a course that needs more than one student", async () => {
    const { fixture } = mount();
    await present(fixture, [training()], {
      catalogue: [SOLO],
      courses: [course({ seatMin: 2 })],
    });

    const control = await screen.findByRole("button", {
      name: `Take ${NAUT} off`,
    });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "This course seats 2 at least, so one student cannot leave it",
    );
    // Cancelling the whole course is the way out RP-1 leaves open here.
    expect(
      screen.getByRole("button", { name: `Cancel the course ${NAUT} is on` }),
    ).toBeEnabled();
    /* Same control as the press, and the same chrome with it. Its name drops
       to the visible label, where the pressable one says "off the course": a
       refusal announcing the act would describe something that cannot
       happen. */
    expect(control).toHaveAttribute("data-command-phase", "idle");
    expect(control).toHaveAccessibleName(`Take ${NAUT} off`);
  });

  /**
   * The seat bounds live on the course listing, so an unread one leaves the
   * removal PRESSABLE and lets the command refuse in RP-1's own words, the same
   * call the build controls make about a condition nobody could evaluate.
   */
  it("leaves both ways out pressable while the course listing is unread", async () => {
    const { fixture } = mount();
    await present(fixture, [training()], { catalogue: [SOLO] });

    expect(
      await screen.findByRole("button", {
        name: `Take ${NAUT} off the course`,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: `Cancel the course ${NAUT} is on` }),
    ).toBeEnabled();
  });

  /** A course that has finished is not a course anybody is on. */
  it("offers enrolment again once the course has completed", async () => {
    const { fixture } = mount();
    await present(fixture, [crewRow()], {
      catalogue: [SOLO],
      courses: [course({ completed: true })],
    });

    await screen.findByRole("combobox", { name: `Training for ${NAUT}` });
    expect(
      screen.queryByRole("button", { name: `Cancel the course ${NAUT} is on` }),
    ).not.toBeInTheDocument();
  });

  /** The other students are named, because cancelling takes every one of them off. */
  it("names who else is on the course", async () => {
    const { fixture } = mount();
    await present(fixture, [training()], {
      catalogue: [SOLO],
      courses: [course()],
    });

    await waitFor(() => {
      expect(visibleText()).toContain("Also on it: Nedcas Kerman");
    });
  });
});
