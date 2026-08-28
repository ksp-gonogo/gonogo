import {
  act,
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
import { describe, expect, it } from "vitest";
import {
  KscVehicles,
  RP1_BUILD_REPEAT_COMMAND,
  RP1_COMPLEX_RUSH_COMMAND,
  RP1_ROLLBACK_COMMAND,
  RP1_ROLLOUT_COMMAND,
  RP1_SCRAP_COMMAND,
} from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.warehouse",
  "rp1.buildQueue",
  "rp1.complexes",
  "rp1.pads",
  "rp1.operations",
  "career.status",
  RP1_BUILD_REPEAT_COMMAND,
  RP1_ROLLOUT_COMMAND,
  RP1_ROLLBACK_COMMAND,
  RP1_SCRAP_COMMAND,
  RP1_COMPLEX_RUSH_COMMAND,
];

const CAREER = {
  economy: { funds: 289_848, reputation: 40, science: 12 },
};

const COMPLEXES = [
  { kscName: "Cape", lcId: "lc-1", name: "LC-1", isOperational: true },
];

/** One free pad, which is the ordinary shape for most of a career. */
const PADS = [
  {
    kscName: "Cape",
    lcId: "lc-1",
    padId: "pad-1",
    name: "LaunchPad",
    launchSiteName: "LaunchPad",
    state: "Free",
    hasVesselWaiting: false,
  },
];

/** One finished vehicle, with every key present as the wire carries it. */
function built(overrides: Record<string, unknown> = {}) {
  return {
    id: "vp-atlas-1",
    // A SECOND id, and the one an operation joins on: RP-1 stamps an
    // operation's associatedID from shipID and never from KCTPersistentID.
    shipId: "ship-atlas-1",
    kscName: "Cape",
    lcId: "lc-1",
    shipName: "Atlas",
    cost: 40_000,
    mass: 120,
    humanRated: false,
    launchSite: "LaunchPad",
    projectType: "VAB",
    ...overrides,
  };
}

/** One vehicle still on the build list. */
function integrating(overrides: Record<string, unknown> = {}) {
  return {
    ...built({ id: "vp-atlas-2", shipId: "ship-atlas-2" }),
    progress: 250,
    totalPoints: 1000,
    progressRatio: 0.25,
    rate: 2,
    timeLeftSeconds: 375,
    stalled: false,
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscVehicles />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** A centre with one finished Atlas and nothing else. */
function withOneBuiltVehicle() {
  const mounted = mount();
  act(() => {
    mounted.fixture.emit("rp1.available", true);
    mounted.fixture.emit("career.status", CAREER);
    mounted.fixture.emit("rp1.complexes", COMPLEXES);
    mounted.fixture.emit("rp1.pads", PADS);
    mounted.fixture.emit("rp1.operations", []);
    mounted.fixture.emit("rp1.buildQueue", []);
    mounted.fixture.emit("rp1.warehouse", [built()]);
  });
  return mounted;
}

/** A rollout or rollback, attached the way RP-1 attaches one: by shipID. */
function operation(overrides: Record<string, unknown> = {}) {
  return {
    kscName: "Cape",
    lcId: "lc-1",
    launchPadId: "LaunchPad",
    type: "Rollout",
    progress: 200,
    totalPoints: 1000,
    progressRatio: 0.2,
    rate: 1,
    timeLeftSeconds: 800,
    stalled: false,
    blockingPeers: 0,
    cost: 4_000,
    associatedVesselId: "ship-atlas-1",
    ...overrides,
  };
}

describe("KscVehicles", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("draws no balance of its own: the host widget carries the one", async () => {
    // The repo rule is per WIDGET, and this section is not one: three augments
    // land in the same panel and two of them used to print the balance, so the
    // widget stated it twice under two different headings. The rule is met once,
    // in the host's chrome, and covered by `SpaceCenterStatus`'s own test that
    // the balance is on screen wherever the sections slot renders.
    const { view } = withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(visibleText()).not.toContain("289,848");
    expect(screen.queryByText("Funds")).not.toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("says plainly that the centre holds no vehicles at all", async () => {
    // A real state on a fresh career, and one an empty section cannot express:
    // no rows and an Uplink that is not reporting look identical.
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(
        screen.getByText("None built and none on order."),
      ).toBeInTheDocument();
    });
  });

  it("offers ONE repeat control for a design that is both built and building", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(screen.getByText("INTEGRATING")).toBeInTheDocument();
    // Two copies of one design, and one control: a button per copy asked an
    // operator to choose between two presses that do the same thing.
    expect(
      screen.getAllByRole("button", { name: /^Build another/ }),
    ).toHaveLength(1);
  });

  it("keeps the repeat off the cards, where it read as building anything", async () => {
    // The defect this placement is for: on a card the control read as "build",
    // which this surface cannot do. RP-1 has no command for building a design
    // the centre has never held, so the only honest control names the design it
    // copies and stands apart from the copies themselves.
    withOneBuiltVehicle();

    const repeat = await screen.findByRole("button", {
      name: "Build another Atlas",
    });
    const card = screen.getByText("Atlas").closest("li");

    expect(card).not.toBeNull();
    expect(card?.contains(repeat)).toBe(false);
    expect(screen.getByText("Repeat a build")).toBeInTheDocument();
  });

  it("dispatches rp1.build.repeat with the vehicle id only after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withOneBuiltVehicle();

    await user.click(
      await screen.findByRole("button", { name: "Build another Atlas" }),
    );
    // Arm first: this spends career funds, and one press must not commit it.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", { name: "Confirm building another Atlas" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
    );
    expect(sent).toBeDefined();
    // The id, never the name: two vehicles of this design would answer to the
    // name and the mod would have to guess which.
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("collapses two copies of a design into one repeat, addressed to a real copy", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [
        built({ id: "vp-atlas-1" }),
        built({ id: "vp-atlas-2" }),
      ]);
      fixture.emit("rp1.buildQueue", []);
    });

    const controls = await screen.findAllByRole("button", {
      name: "Build another Atlas",
    });
    expect(controls).toHaveLength(1);
    await user.click(controls[0]);
    await user.click(
      screen.getByRole("button", { name: "Confirm building another Atlas" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
    );
    // An id and not a name, still: the command copies one existing project, so
    // it has to name which, even where the two are the same design.
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("names the complex on the repeat where the centre has more than one", async () => {
    // Two centres can hold designs of the same name, and then "Build another
    // Atlas" twice is two buttons an operator cannot tell apart.
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        ...COMPLEXES,
        { kscName: "Cape", lcId: "lc-2", name: "LC-2", isOperational: true },
      ]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [
        built(),
        built({ id: "vp-atlas-3", lcId: "lc-2", shipId: "ship-atlas-3" }),
      ]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Build another Atlas · LC-1" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Build another Atlas · LC-2" }),
    ).toBeInTheDocument();
  });

  it("says a vehicle RP-1 gave no id to cannot be repeated, rather than offering to guess", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built({ id: null })]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/RP-1 has no id for this vehicle/),
      ).toBeInTheDocument();
    });
    // EVERY control, not just the build: none of the four can name a target
    // without the id, and guessing from the name would pick the wrong one of two
    // vehicles that share it.
    expect(screen.queryAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /^Rush work at/ }),
    ).toBeInTheDocument();
  });

  it("names the complex only when the centre has more than one", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        ...COMPLEXES,
        { kscName: "Cape", lcId: "lc-2", name: "LC-2", isOperational: true },
      ]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    // On the card's own detail line rather than appended to the name: the name
    // is the heading of a card and reads as one, and hanging a second identifier
    // off it was what made a run of rows hard to tell apart in the first place.
    expect(visibleText()).toContain("Atlas");
    expect(visibleText()).toContain("LC-1 · costs");
  });

  it("rolls a built vehicle out to the pad, after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withOneBuiltVehicle();

    // One free pad, so one button, and it still reads "Roll out" rather than
    // repeating a name the operator has no choice about.
    const control = await screen.findByRole("button", {
      name: "Roll Atlas out to LaunchPad",
    });
    expect(control).toHaveTextContent("Roll out");
    await user.click(control);
    // Armed, not sent. A rollout commits the career to a bill it pays as the
    // vehicle moves, so one press must not start it.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_ROLLOUT_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", {
        name: "Confirm rolling Atlas out to LaunchPad",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLOUT_COMMAND,
    );
    // The pad is on the wire even though there was only one to choose. The mod
    // REQUIRES it, so the dispatch records where the vehicle was sent rather
    // than leaving it to be inferred from whichever pad was free at the time.
    expect(sent?.args).toEqual({ id: "vp-atlas-1", pad: "LaunchPad" });
  });

  it("makes the operator choose when the complex has more than one free pad", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [
        ...PADS,
        {
          kscName: "Cape",
          lcId: "lc-1",
          padId: "pad-2",
          name: "LaunchPad 2",
          launchSiteName: "LaunchPad 2",
          state: "Free",
          hasVesselWaiting: false,
        },
      ]);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    // The choice is made HERE, where the names are visible, rather than as a
    // refusal the operator has to read and retry: RP-1 asks with a popup and
    // there is nobody to answer a popup from another machine.
    await user.click(
      await screen.findByRole("button", {
        name: "Roll Atlas out to LaunchPad 2",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm rolling Atlas out to LaunchPad 2",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLOUT_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1", pad: "LaunchPad 2" });
  });

  it("shows a vehicle on its way to the pad and offers only the way back", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollout" }]);
      fixture.emit("rp1.operations", [operation()]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("ROLLING OUT")).toBeInTheDocument();
    });
    // The operation OUTRANKS the list: the vehicle is still in the warehouse, so
    // "BUILT" would be true and would tell an operator nothing they need.
    expect(screen.queryByText("BUILT")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Roll Atlas back off the pad" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas out/ }),
    ).not.toBeInTheDocument();
    // RP-1 refuses a scrap for a vehicle mid-move, so offering one would be
    // offering a press that can only be refused.
    expect(
      screen.queryByRole("button", { name: /^Scrap/ }),
    ).not.toBeInTheDocument();
  });

  it("says a completed rollout is AT PAD rather than still rolling out", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollout" }]);
      fixture.emit("rp1.operations", [
        operation({ progress: 1000, progressRatio: 1, timeLeftSeconds: null }),
      ]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("AT PAD")).toBeInTheDocument();
    });
    // Still reversible, and that is RP-1's own rule: a rolled-out vehicle can be
    // rolled back until it launches.
    expect(
      screen.getByRole("button", { name: "Roll Atlas back off the pad" }),
    ).toBeInTheDocument();
  });

  it("dispatches the rollback with the vehicle id", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollout" }]);
      fixture.emit("rp1.operations", [operation()]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Roll Atlas back off the pad",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm rolling Atlas back off the pad",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLBACK_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("offers a rolling-back vehicle the way back out to the pad", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollback" }]);
      fixture.emit("rp1.operations", [operation({ type: "Rollback" })]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("ROLLING BACK")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", {
        name: "Send Atlas back out to the pad",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm sending Atlas back out to the pad",
      }),
    );

    // The SAME command as a fresh rollout, because the mod reverses the existing
    // operation rather than starting a second one. That is what keeps rollout a
    // direction rather than a toggle.
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLOUT_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas back/ }),
    ).not.toBeInTheDocument();
  });

  it("does not attach another vehicle's rollout to this row", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      // Same complex, a DIFFERENT ship id. Joining on the wrong id, or on the
      // complex alone, would mark every vehicle at LC-1 as rolling out.
      fixture.emit("rp1.operations", [
        operation({ associatedVesselId: "ship-vanguard-1" }),
      ]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(screen.queryByText("ROLLING OUT")).not.toBeInTheDocument();
  });

  it("ignores a pad's reconditioning when reading a vehicle's state", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Reconditioning" }]);
      // Reconditioning belongs to a PAD and carries no vehicle, so RP-1 stamps
      // it with the pad's id. A row that matched it would report a pad's
      // maintenance as a vehicle moving.
      fixture.emit("rp1.operations", [
        operation({ type: "Reconditioning", associatedVesselId: null }),
      ]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    // No offerable pad, so a SENTENCE rather than a button that could only be
    // refused, and it says which of four things is wrong: repair it, build it,
    // wait for reconditioning, or move the vehicle already there.
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas out/ }),
    ).not.toBeInTheDocument();
    expect(visibleText()).toContain("reconditioned");
  });

  it("scraps a vehicle for its refund, after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withOneBuiltVehicle();

    await user.click(
      await screen.findByRole("button", { name: "Scrap Atlas" }),
    );
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_SCRAP_COMMAND,
      ),
    ).toBeUndefined();
    // The confirm says what comes BACK, because that is the fact an operator
    // weighs: RP-1 refunds the vehicle in full and the loss is the integration
    // time, which no number on this row can show.
    expect(visibleText()).toContain("Refund");

    await user.click(
      screen.getByRole("button", { name: "Confirm scrapping Atlas" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_SCRAP_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("scraps a vehicle that is still integrating, which is how a queue gets corrected", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await user.click(
      await screen.findByRole("button", { name: "Scrap Atlas" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm scrapping Atlas" }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_SCRAP_COMMAND,
      )?.args,
    ).toEqual({ id: "vp-atlas-2" });
    // No rollout for a vehicle that is not built yet. RP-1 draws that control
    // only on a warehouse row, and an unbuilt vehicle has nothing to move.
    expect(
      screen.queryByRole("button", { name: /^Roll/ }),
    ).not.toBeInTheDocument();
  });

  it("rushes a whole complex on one press, and says the mode is per complex", async () => {
    const user = userEvent.setup();
    const { fixture } = withOneBuiltVehicle();

    // One press, unlike every other control here, and the difference is real:
    // rushing spends nothing when it lands. It raises the rate and the salary
    // multiplier, so the cost arrives later as payroll.
    await user.click(
      await screen.findByRole("button", {
        name: "Rush work at LC-1, at a higher salary",
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
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [{ ...COMPLEXES[0], isRushing: true }]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: "Stop rushing work at LC-1" }),
    );

    // A SET and not a toggle on the wire: the command carries the state asked
    // for, so it lands on that state however stale the view it was pressed from.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
      )?.args,
    ).toEqual({ lcId: "lc-1", rushing: false });
  });

  it("offers a rush control for every complex, not just the one with vehicles", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        ...COMPLEXES,
        { kscName: "Cape", lcId: "lc-2", name: "LC-2", isOperational: true },
      ]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      // The row is named for the COMPLEX. "LC-1 rush" read as a second thing
      // called LC-1 rush that happened to have a rush button beside it; what
      // the press does is the button's own job to say.
      expect(
        screen.getByRole("button", { name: /Rush work at LC-1/ }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("LC-1")).toBeInTheDocument();
    expect(screen.queryByText("LC-1 rush")).not.toBeInTheDocument();
    // An idle complex is exactly the one worth taking OUT of rush mode, so a
    // control drawn only beside vehicles would hide the useful half. LC-2 holds
    // no vehicle in this state, so its row is the whole of what proves it.
    expect(screen.getByText("LC-2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Rush work at LC-2/ }),
    ).toBeInTheDocument();
  });

  it("stays accessible with every control on screen at once", async () => {
    const { fixture, view } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", [operation()]);
      fixture.emit("rp1.warehouse", [
        built(),
        built({ id: "vp-atlas-3", shipId: "ship-atlas-3" }),
      ]);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await waitFor(() => {
      expect(screen.getByText("ROLLING OUT")).toBeInTheDocument();
    });
    await expectNoA11yViolations(view.container);
  });

  it("will not offer a pad that reads free with a craft standing on it", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      // Free AND occupied at once, which is a real RP-1 state and the reason
      // hasVesselWaiting had to go on the wire: State derives from the pad's
      // OPERATIONS, and a craft already sent to the launch site has none left.
      fixture.emit("rp1.pads", [
        {
          ...PADS[0],
          state: "Free",
          hasVesselWaiting: true,
          waitingVesselName: "Vanguard",
        },
      ]);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    // A client reading `state` alone would draw this button and be refused.
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas out/ }),
    ).not.toBeInTheDocument();
    // Named, because "the pad is taken" leaves an operator looking and
    // "Vanguard is on it" tells them what to move.
    expect(visibleText()).toContain("Vanguard");
  });

  it("still offers a pad whose occupancy the mod could not determine", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      // Null, not false: the mod could not answer. Treating that as occupied
      // would hide a control that works, and the command re-checks at the press,
      // so the worst case of offering it is a refusal one step later.
      fixture.emit("rp1.pads", [{ ...PADS[0], hasVesselWaiting: null }]);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    expect(
      await screen.findByRole("button", {
        name: "Roll Atlas out to LaunchPad",
      }),
    ).toBeInTheDocument();
  });

  it("quotes RP-1's own reasons when the complex will not release the vehicle", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [
        built({
          rolloutRefusals: [
            "too heavy for the complex at 120.0 t, limit 40.0 t",
            "human-rated, and the complex is not",
          ],
        }),
      ]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(visibleText()).toContain("too heavy for the complex");
    });
    // EVERY reason, not just the first: an operator who fixes one and is handed
    // the next has been made to iterate, and RP-1's own popup lists them at once.
    expect(visibleText()).toContain("human-rated");
    // The VEHICLE half outranks the pads: a free pad is on the wire and no
    // rollout is offered, because no pad can take a vehicle its complex will not
    // release.
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas out/ }),
    ).not.toBeInTheDocument();
    // Scrap is still offered. Correcting the queue is exactly what an operator
    // does about a vehicle its complex will never fly.
    expect(
      screen.getByRole("button", { name: "Scrap Atlas" }),
    ).toBeInTheDocument();
  });

  it("registers itself into the space centre's section slot", () => {
    const ids = getAugmentsForSlot("space-center-status.sections").map(
      (a) => a.id,
    );
    expect(ids).toContain("rp1-ksc-vehicles");
  });
});
