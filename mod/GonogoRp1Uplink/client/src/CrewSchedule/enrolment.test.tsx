import { CrewStanding } from "@ksp-gonogo/sitrep-sdk";
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
import { TrainingEnrolment } from "./enrolment";
import { RP1_TRAINING_ENROL_COMMAND } from "./training";

const TOPICS = [
  "rp1.available",
  "rp1.crew",
  "rp1.training",
  "rp1.trainingCatalogue",
  "rp1.crewProgram",
  "spaceCenter.crewRoster",
  "career.status",
  RP1_TRAINING_ENROL_COMMAND,
];

/** RP-1's own crew rules: every mechanic on, both training rates at 1. */
const DEFAULT_RULES = {
  crewRnREnabled: true,
  missionTrainingEnabled: true,
  missionTrainingRate: 1,
  proficiencyTrainingRate: 1,
  retirementEnabled: true,
};

const LUDREY = "Ludrey Kerman";
const NEDCAS = "Nedcas Kerman";
const VALENTINA = "Valentina Kerman";

/** A training RP-1 will not run below two students, which is the whole gap. */
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

function rosterRow(name: string, overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    courage: 0.5,
    experienceLevel: 1,
    experienceLevelDelta: 0.1,
    name,
    situation: "Available",
    situationOrdinal: 0,
    standing: CrewStanding.Available,
    stupidity: 0.5,
    trait: "Pilot",
    unavailableReason: "",
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <TrainingEnrolment />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/**
 * RP-1 present and the four channels this section reads answered.
 *
 * <para>One round rather than two: every read sits above the early returns, so
 * all four are subscribed from the first mount and none of them waits on
 * another arriving first.</para>
 */
async function present(
  fixture: ReturnType<typeof setupStreamFixture>,
  {
    career = undefined as Record<string, unknown> | undefined,
    catalogue = [PAIR, SOLO],
    courses = [] as Record<string, unknown>[],
    crew = [] as Record<string, unknown>[],
    program = {} as Record<string, unknown>,
    roster = [rosterRow(LUDREY), rosterRow(NEDCAS)],
  }: {
    /* The career's own economy. Undefined by default, because a save with no
       RP-1 economy reading is a real state and most tests here are not about
       it. */
    career?: Record<string, unknown>;
    catalogue?: Record<string, unknown>[];
    courses?: Record<string, unknown>[];
    crew?: Record<string, unknown>[];
    /* The crew rules, which this section reads for one thing only: whether
       mission training is running at all. Defaulted to RP-1's own, so a test
       that says nothing about the settings gets a save on the defaults. */
    program?: Record<string, unknown>;
    roster?: Record<string, unknown>[];
  } = {},
) {
  await waitFor(() => {
    expect(fixture.transport.isSubscribed("rp1.trainingCatalogue")).toBe(true);
    expect(fixture.transport.isSubscribed("spaceCenter.crewRoster")).toBe(true);
  });
  act(() => {
    fixture.emit("rp1.available", true);
    fixture.emit("spaceCenter.crewRoster", roster);
    fixture.emit("rp1.crew", crew);
    fixture.emit("rp1.training", courses);
    fixture.emit("rp1.crewProgram", { ...DEFAULT_RULES, ...program });
    fixture.emit("rp1.trainingCatalogue", catalogue);
    if (career !== undefined) {
      fixture.emit("career.status", career);
    }
  });
}

/**
 * One kerbal's control, found by a name PREFIX rather than the whole name: a
 * refused kerbal wears their reason on the label, so the accessible name is the
 * name plus two words and an exact match would find only the pickable ones.
 */
function student(name: string) {
  return screen.findByRole("button", { name: new RegExp(name) });
}

/** Pick these kerbals as students, in order. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  ...names: string[]
) {
  for (const name of names) {
    await user.click(await screen.findByRole("button", { name }));
  }
}

describe("filling a multi-seat training", () => {
  /**
   * The command names a template and a LIST of kerbals, and RP-1 refuses the
   * whole thing rather than starting a seat short, so a two-seat training has to
   * leave here in one dispatch carrying both names.
   */
  it("sends one command naming the whole crew", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();
    await present(fixture);

    await pick(user, LUDREY, NEDCAS);
    await user.click(
      screen.getByRole("button", {
        name: "Enrol 2 students on Mission training: Gemini",
      }),
    );
    // Armed, not sent: starting a course grounds every student on it for the
    // length of the course, so one press must not commit them.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", {
        name: "Confirm enrolling 2 students on Mission training: Gemini",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
      )?.args,
    ).toEqual({ crew: [LUDREY, NEDCAS], templateId: "tt-gemini" });
    await expectNoA11yViolations(view.container);
  });

  it("enrols on the training the operator picked", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture);

    await user.click(
      await screen.findByRole("button", {
        name: "Proficiency: Mercury-Redstone",
      }),
    );
    await pick(user, NEDCAS);
    await user.click(
      screen.getByRole("button", {
        name: "Enrol 1 student on Proficiency: Mercury-Redstone",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm enrolling 1 student on Proficiency: Mercury-Redstone",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_TRAINING_ENROL_COMMAND,
      )?.args,
    ).toEqual({ crew: [NEDCAS], templateId: "tt-mercury" });
  });

  /**
   * RP-1 generates two trainings per crewed part and the operator is choosing
   * between them: a proficiency is a permanent qualification, mission training
   * expires a set interval after the course completes. The row carries the
   * title and nothing else, the same as RP-1's own course list, so the
   * consequence of the pick is stated once, under the list, for the pick.
   */
  it("states whether the picked training lapses or is permanent", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, { catalogue: [PAIR, SOLO] });

    await waitFor(() => {
      expect(visibleText()).toContain("Lapses after completion");
    });
    await user.click(
      screen.getByRole("button", { name: "Proficiency: Mercury-Redstone" }),
    );
    expect(visibleText()).toContain("Permanent once complete");
    expect(visibleText()).not.toContain("Lapses after completion");
  });

  /**
   * The setting is honoured rather than reported. With mission training off
   * RP-1 generates no such template and never checks one, so offering a
   * survivor from before the switch was thrown would start a course nothing
   * will ever look at.
   */
  it("offers no mission training on a save that has it off", async () => {
    const { fixture } = mount();
    await present(fixture, {
      catalogue: [PAIR, SOLO],
      program: { missionTrainingEnabled: false },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Proficiency: Mercury-Redstone" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Mission training: Gemini" }),
    ).not.toBeInTheDocument();
  });

  /**
   * `rp1.training.enrol` does not ask whether a training is unlocked, because
   * RP-1's own screen answers that by not listing it. Offering one would start a
   * course on hardware the career has not researched.
   */
  it("offers only the trainings the career has unlocked", async () => {
    const { fixture } = mount();
    await present(fixture, { catalogue: [SOLO, LOCKED] });

    await screen.findByRole("group", { name: "Training to start" });
    expect(
      screen.queryByRole("button", { name: "Proficiency: Saturn V" }),
    ).not.toBeInTheDocument();
  });
});

describe("the shape of the training picker", () => {
  /**
   * RP-1's own Astronaut Complex offers a training by drawing EVERY template it
   * will list as its own button, all of them on screen at once, and a press
   * selects one (`TrainingGUI.RenderCourseSelector`, a scroll view of
   * `GUILayout.Button` per `TrainingTemplate`). A collapsed dropdown is a
   * different gesture for the same decision: it shows one training and hides the
   * rest behind an interaction, where the screen an operator knows shows the
   * whole catalogue and the pressed one.
   */
  it("draws every offered training as its own pressable row, the way RP-1 does", async () => {
    const { fixture } = mount();
    await present(fixture, { catalogue: [PAIR, SOLO] });

    const gemini = await screen.findByRole("button", {
      name: "Mission training: Gemini",
    });
    const mercury = screen.getByRole("button", {
      name: "Proficiency: Mercury-Redstone",
    });
    expect(gemini).toHaveAttribute("aria-pressed", "true");
    expect(mercury).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /** The press moves the pick, the same as pressing a course in RP-1's list. */
  it("moves the pick to the training that was pressed", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, { catalogue: [PAIR, SOLO] });

    await user.click(
      await screen.findByRole("button", {
        name: "Proficiency: Mercury-Redstone",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Proficiency: Mercury-Redstone" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Mission training: Gemini" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the seat bounds", () => {
  it("refuses a crew below the minimum, with the count", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture);

    await pick(user, LUDREY);
    const control = screen.getByRole("button", { name: "Enrol" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "Mission training: Gemini needs 2 students and 1 student is picked",
    );
    // And the bounds are on screen, so the dark control reads as a fact about
    // the training rather than about the operator.
    expect(visibleText()).toContain("seats 2");
  });

  it("refuses a crew above the maximum, with the count", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, {
      roster: [rosterRow(LUDREY), rosterRow(NEDCAS), rosterRow(VALENTINA)],
    });

    await pick(user, LUDREY, NEDCAS, VALENTINA);
    const control = screen.getByRole("button", { name: "Enrol" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "Mission training: Gemini seats 2 and 3 students are picked",
    );
  });

  it("refuses an empty crew in RP-1's own terms", async () => {
    const { fixture } = mount();
    await present(fixture, { catalogue: [SOLO] });

    const control = await screen.findByRole("button", { name: "Enrol" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      "Nobody is picked, and RP-1 has no such thing as an empty course",
    );
  });

  /**
   * RP-1 defaults an unreadable minimum to one internally, and a client that
   * assumed the same would be guessing at the one number this surface exists
   * for. So an absent minimum refuses nothing and the command answers.
   */
  it("stays pressable when RP-1 sent no minimum", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, {
      catalogue: [{ ...PAIR, seatMax: undefined, seatMin: undefined }],
    });

    await pick(user, LUDREY);
    expect(
      screen.getByRole("button", {
        name: "Enrol 1 student on Mission training: Gemini",
      }),
    ).toBeEnabled();
  });

  /**
   * The refusal and the press are ONE control, so the one an operator cannot
   * press is never drawn louder than the one they can: the kit's `Button`, which
   * used to carry the refusal, is a font size larger and uppercase where
   * `CommandButton size="sm"` is neither.
   *
   * `data-command-phase` is what a call site reverting to a plain disabled
   * `Button` would lose, so it is what this asserts.
   *
   * The accessible NAME is pinned either side of the refusal too, because
   * merging the two controls is where it would quietly move: the live one names
   * the act and its student count, and the refused one keeps its visible word
   * with the reason in `title`, which is what each announced when they were two
   * components.
   */
  it("draws the refusal with the control that would do the press", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture);

    const refused = await screen.findByRole("button", { name: "Enrol" });
    expect(refused).toBeDisabled();
    expect(refused).toHaveAttribute("data-command-phase", "idle");
    expect(refused).toHaveAccessibleName("Enrol");

    await pick(user, LUDREY, NEDCAS);
    const live = screen.getByRole("button", {
      name: "Enrol 2 students on Mission training: Gemini",
    });
    expect(live).toBeEnabled();
    expect(live).toHaveAttribute("data-command-phase", "idle");
    // The reason went with the refusal rather than staying behind on the live
    // control, where it would describe a press that is now available.
    expect(live).not.toHaveAttribute("title");
  });
});

describe("who RP-1 would refuse", () => {
  it.each([
    [
      "already training",
      CrewStanding.Training,
      `${VALENTINA} is already on a training course`,
      "in training",
    ],
    [
      "standing down after a flight",
      CrewStanding.Resting,
      `${VALENTINA} is standing down after a flight`,
      "resting",
    ],
    [
      "off-world",
      CrewStanding.Assigned,
      `${VALENTINA} is off-world`,
      "off-world",
    ],
  ])("names a kerbal who is %s", async (_what, standing, reason, tag) => {
    const { fixture } = mount();
    await present(fixture, {
      roster: [
        rosterRow(LUDREY),
        rosterRow(NEDCAS),
        rosterRow(VALENTINA, { standing }),
      ],
    });

    const control = await student(VALENTINA);
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("title", reason);
    // And the reason is on the label, not only in the title. Every peer here is
    // a kerbal's name in the same chip, so dimming alone would leave "cannot be
    // picked" looking like "not picked yet".
    expect(control).toHaveAccessibleName(new RegExp(`${VALENTINA} . ${tag}`));
  });

  /**
   * The course listing is RP-1's own answer and is read alongside the derived
   * standing, so a kerbal on a course is out whichever channel says so first.
   */
  it("names a kerbal the course listing has on a course", async () => {
    const { fixture } = mount();
    await present(fixture, {
      courses: [
        {
          completed: false,
          id: "tt-mercury",
          seatMin: 1,
          started: true,
          students: [VALENTINA],
        },
      ],
      roster: [rosterRow(LUDREY), rosterRow(NEDCAS), rosterRow(VALENTINA)],
    });

    const control = await student(VALENTINA);
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      `${VALENTINA} is already on a training course`,
    );
  });

  /** A finished course is not a course anybody is on, the same as the mod side reads it. */
  it("offers a kerbal whose course has completed", async () => {
    const { fixture } = mount();
    await present(fixture, {
      courses: [
        {
          completed: true,
          id: "tt-mercury",
          seatMin: 1,
          started: true,
          students: [VALENTINA],
        },
      ],
      roster: [rosterRow(LUDREY), rosterRow(VALENTINA)],
    });

    expect(
      await screen.findByRole("button", { name: VALENTINA }),
    ).toBeEnabled();
  });

  /** An unread standing is not a standing that bars anybody. */
  it("offers a kerbal whose standing nobody could read", async () => {
    const { fixture } = mount();
    await present(fixture, {
      roster: [
        rosterRow(LUDREY),
        rosterRow(VALENTINA, { standing: undefined }),
      ],
    });

    expect(
      await screen.findByRole("button", { name: VALENTINA }),
    ).toBeEnabled();
  });

  /**
   * Dropped rather than refused. A retiree is not a candidate whose turn has
   * not come, and an applicant is not crew; the host already sorts both into
   * their own tabs.
   */
  it.each([
    ["a retiree", { standing: CrewStanding.Retired }],
    ["a fatality", { standing: CrewStanding.Dead }],
    ["an applicant", { isApplicant: true, standing: CrewStanding.Applicant }],
  ])("leaves %s off the list entirely", async (_what, overrides) => {
    const { fixture } = mount();
    await present(fixture, {
      roster: [rosterRow(LUDREY), rosterRow(VALENTINA, overrides)],
    });

    await screen.findByRole("button", { name: LUDREY });
    expect(
      screen.queryByRole("button", { name: VALENTINA }),
    ).not.toBeInTheDocument();
  });

  /**
   * All-or-none is the whole reason the name matters: RP-1 refuses the command
   * by the name of the first student it will not take, so a pick that has gone
   * stale has to say WHO rather than that something is wrong.
   */
  it("names a picked kerbal who has since become ineligible", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, {
      roster: [rosterRow(LUDREY), rosterRow(NEDCAS)],
    });

    await pick(user, LUDREY, NEDCAS);
    expect(
      screen.getByRole("button", {
        name: "Enrol 2 students on Mission training: Gemini",
      }),
    ).toBeEnabled();

    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
        rosterRow(LUDREY),
        rosterRow(NEDCAS, { standing: CrewStanding.Assigned }),
      ]);
    });

    const control = await screen.findByRole("button", { name: "Enrol" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute(
      "title",
      `${NEDCAS} cannot take this training, and RP-1 refuses the whole crew rather than starting a seat short`,
    );
  });

  /**
   * The one place a refusal is NOT a dark control: a kerbal picked while idle
   * and then grounded elsewhere would otherwise be locked into a crew that
   * cannot be sent and cannot be taken back out.
   */
  it("lets a picked kerbal who became ineligible be taken back out", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await present(fixture, { roster: [rosterRow(LUDREY), rosterRow(NEDCAS)] });

    await pick(user, LUDREY, NEDCAS);
    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
        rosterRow(LUDREY),
        rosterRow(NEDCAS, { standing: CrewStanding.Assigned }),
      ]);
    });

    /* Found by the TAGGED label, which is also the assertion: a crew that has
       gone stale says which name went stale without an operator hovering to
       find out, and the wait is what lets the re-emitted roster land first. */
    const stale = await screen.findByRole("button", {
      name: new RegExp(`${NEDCAS} . off-world`),
    });
    expect(stale).toBeEnabled();
    await user.click(stale);

    expect(screen.getByRole("button", { name: "Enrol" })).toHaveAttribute(
      "title",
      "Mission training: Gemini needs 2 students and 1 student is picked",
    );
  });
});

describe("what it declines to draw", () => {
  it("renders nothing on a stock game", async () => {
    const { fixture, view } = mount();
    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    act(() => {
      fixture.emit("rp1.available", false);
    });

    expect(view.container.textContent).toBe("");
  });

  /**
   * The unread catalogue is stated on every naut's row by the per-row control,
   * a few inches above this in the same widget, so a second line here would
   * repeat it. Silence rather than the one line an unreadable state is
   * otherwise worth.
   */
  it("renders nothing while the catalogue is unread", async () => {
    const { fixture, view } = mount();
    await waitFor(() => {
      expect(fixture.transport.isSubscribed("spaceCenter.crewRoster")).toBe(
        true,
      );
    });
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("spaceCenter.crewRoster", [rosterRow(LUDREY)]);
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });

  it("renders nothing when the career has unlocked no training", async () => {
    const { fixture, view } = mount();
    await present(fixture, { catalogue: [LOCKED] });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });

  it("renders nothing when nobody on the books could be a student", async () => {
    const { fixture, view } = mount();
    await present(fixture, {
      roster: [rosterRow(VALENTINA, { standing: CrewStanding.Retired })],
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });

  /**
   * The crew roster is the HOST's channel and the Astronaut Complex says so
   * above this already, so a second line here would repeat it.
   */
  it("renders nothing while the crew roster is unread", async () => {
    const { fixture, view } = mount();
    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.trainingCatalogue")).toBe(
        true,
      );
    });
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("rp1.trainingCatalogue", [PAIR, SOLO]);
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });
});

describe("the reading order", () => {
  /** The names an operator can act on are the ones they are looking for. */
  it("puts the pickable names before the refused ones", async () => {
    const { fixture } = mount();
    await present(fixture, {
      roster: [
        rosterRow(VALENTINA, { standing: CrewStanding.Assigned }),
        rosterRow(LUDREY),
        rosterRow(NEDCAS, { standing: CrewStanding.Resting }),
      ],
    });

    await screen.findByRole("button", { name: LUDREY });
    const text = visibleText();
    expect(text.indexOf(LUDREY)).toBeLessThan(text.indexOf(VALENTINA));
    expect(text.indexOf(LUDREY)).toBeLessThan(text.indexOf(NEDCAS));
  });
});

describe("the way onto a course, in the order an operator meets it", () => {
  /**
   * The picker BEFORE the press, which is the whole of the operator's question.
   *
   * <para>The send control used to sit on the same line as the training picker,
   * above both the bounds and the names, so the reading order was: choose a
   * training, press Enrol, and only then meet the kerbals the press was supposed
   * to name. An operator who read the screen top to bottom found a dark button
   * and no way to make it live, and asked how you enrol a kerbal on a course at
   * all. The names are a step, so they come before the step that sends
   * them.</para>
   */
  it("draws the students above the control that sends them", async () => {
    const { fixture } = mount();
    await present(fixture);

    await screen.findByRole("button", { name: LUDREY });
    const text = visibleText();
    expect(text.indexOf(LUDREY)).toBeLessThan(text.indexOf("Enrol"));
  });

  /**
   * A refused control states its reason where it can be READ.
   *
   * <para>The reason rode `title` alone, which is a hover: on the one picture
   * this section exists for, a dark Enrol sat under a picker with nothing on
   * screen saying which arithmetic had failed. `title` stays, because it is what
   * a pointer reaches; the sentence is on screen as well because a refusal
   * nobody can see is a refusal nobody can act on.</para>
   */
  it("states the refusal on screen and not only on hover", async () => {
    const { fixture } = mount();
    await present(fixture);

    await screen.findByRole("button", { name: LUDREY });
    expect(visibleText()).toContain("needs 2 students and nobody is picked");
  });

  /**
   * What the career pays for training, beside the control that adds to it.
   *
   * <para>Enrolling charges nothing at the press and RP-1 never refuses one on
   * affordability, so there is no balance to draw and "cannot afford" would be a
   * falsehood. What it does do is start a per-day drain that runs for the length
   * of the course, so the RATE is the reading, and it is RP-1's own line rather
   * than one derived here.</para>
   */
  it("shows what training draws per day when the career reports it", async () => {
    const { fixture } = mount();
    await present(fixture, {
      career: { economy: { upkeep: { training: 1234 } } },
    });

    await screen.findByRole("button", { name: LUDREY });
    expect(visibleText()).toContain("Upkeep");
    expect(visibleText()).toContain("1234");
    expect(visibleText()).toContain("f/day");
  });

  /** Absent, not zero: a career with no economy reading levies no known rate. */
  it("draws no upkeep line when the career reports none", async () => {
    const { fixture } = mount();
    await present(fixture);

    await screen.findByRole("button", { name: LUDREY });
    expect(visibleText()).not.toContain("Upkeep");
  });
});
