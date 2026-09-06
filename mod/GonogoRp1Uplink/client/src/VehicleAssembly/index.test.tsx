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
  WidgetHost,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RP1_BUILD_REPEAT_COMMAND, VehicleAssembly } from "./index";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";
import {
  RP1_ROLLBACK_COMMAND,
  RP1_ROLLOUT_COMMAND,
  RP1_SCRAP_COMMAND,
} from "./VehicleSection";

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
];

const CAREER = {
  economy: { funds: 289_848, reputation: 40, science: 12 },
};

const COMPLEXES = [
  {
    engineers: 18,
    isOperational: true,
    kscName: "Cape",
    lcId: "lc-1",
    lcType: "Pad",
    maxEngineers: 60,
    name: "LC-1",
  },
];

/** A second complex, for the multi-complex case this widget exists for. */
const LC2 = {
  engineers: 6,
  isOperational: true,
  kscName: "Cape",
  lcId: "lc-2",
  lcType: "Pad",
  maxEngineers: 40,
  name: "LC-2",
};

/** One free pad, which is the ordinary shape for most of a career. */
const PADS = [
  {
    hasVesselWaiting: false,
    kscName: "Cape",
    launchSiteName: "LaunchPad",
    lcId: "lc-1",
    name: "LaunchPad",
    padId: "pad-1",
    state: "Free",
  },
];

/** One finished vehicle, with every key present as the wire carries it. */
function built(overrides: Record<string, unknown> = {}) {
  return {
    cost: 40_000,
    humanRated: false,
    id: "vp-atlas-1",
    kscName: "Cape",
    launchSite: "LaunchPad",
    lcId: "lc-1",
    mass: 120,
    projectType: "VAB",
    // What the MOVE costs, which is a different number from what the vehicle
    // cost to build and the one the rollout control spends.
    rolloutCost: 4_000,
    // A SECOND id, and the one an operation joins on: RP-1 stamps an
    // operation's associatedID from shipID and never from KCTPersistentID.
    shipId: "ship-atlas-1",
    shipName: "Atlas",
    ...overrides,
  };
}

/** One vehicle still on the build list. */
function integrating(overrides: Record<string, unknown> = {}) {
  return {
    ...built({ id: "vp-atlas-2", shipId: "ship-atlas-2" }),
    progress: 250,
    progressRatio: 0.25,
    rate: 2,
    stalled: false,
    timeLeftSeconds: 375,
    totalPoints: 1000,
    ...overrides,
  };
}

/** A rollout or rollback, attached the way RP-1 attaches one: by shipID. */
function operation(overrides: Record<string, unknown> = {}) {
  return {
    associatedVesselId: "ship-atlas-1",
    blockingPeers: 0,
    cost: 4_000,
    // 20% of the way there, so a fifth of the price is already drawn down.
    costRemaining: 3_200,
    kscName: "Cape",
    launchPadId: "LaunchPad",
    lcId: "lc-1",
    progress: 200,
    progressRatio: 0.2,
    rate: 1,
    stalled: false,
    timeLeftSeconds: 800,
    totalPoints: 1000,
    type: "Rollout",
    ...overrides,
  };
}

/**
 * The widget as the dashboard mounts it.
 *
 * <para>Through `WidgetHost` rather than bare, and that is load-bearing rather
 * than ceremony: both vehicle lists arrive through the widget's own
 * `sections` slot, and that slot's name is completed from the mounting widget's
 * meta. Rendered without it the panel opens no slot at all and every assertion
 * below would be made against an empty body.</para>
 */
function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <WidgetHost widgetId="rp1-vehicle-assembly">
        <VehicleAssembly />
      </WidgetHost>
    </fixture.Provider>,
  );
  return { fixture, view };
}

/**
 * RP-1's presence gate, and the wait for what it mounts to reach the wire.
 *
 * <para>Nothing in this widget's body mounts until the gate lands, and the stub
 * transport is subscription-gated the way production is: a payload emitted
 * before a subscription is open is dropped. Both contributed sections read the
 * pads and the operations, and both of them mount behind this gate, so a test
 * that emits a pad in the same breath as the gate emits it into a tree that has
 * not asked for it yet and then reads "this complex has no pads".</para>
 *
 * <para>Waited on the SUBSCRIPTION rather than on anything drawn: the sections
 * draw nothing at all until their lists arrive, so there is no mark on screen
 * that says the subscription is open, and a wait on the panel title passes a
 * beat too early.</para>
 */
async function rp1IsPresent(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.emit("rp1.available", true);
  });
  await waitFor(() => {
    expect(fixture.transport.isSubscribed("rp1.pads")).toBe(true);
    expect(fixture.transport.isSubscribed("rp1.operations")).toBe(true);
  });
}

/** A centre with one finished Atlas and nothing else. */
async function withOneBuiltVehicle() {
  const mounted = mount();
  await rp1IsPresent(mounted.fixture);
  act(() => {
    mounted.fixture.emit("career.status", CAREER);
    mounted.fixture.emit("rp1.complexes", COMPLEXES);
    mounted.fixture.emit("rp1.pads", PADS);
    mounted.fixture.emit("rp1.operations", []);
    mounted.fixture.emit("rp1.buildQueue", []);
    mounted.fixture.emit("rp1.warehouse", [built()]);
  });
  return mounted;
}

describe("VehicleAssembly", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("draws the balance every control in it spends against", async () => {
    // The repo rule is per WIDGET: this one hosts a scrap, a rollout and a
    // repeat, so the balance an operator judges them against has to be in it.
    // Drawn once, by the host, which is what lets both contributed sections
    // carry none.
    const { view } = await withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(screen.getAllByTitle("Available funds")).toHaveLength(1);
    expect(visibleText()).toContain("289,848");
    await expectNoA11yViolations(view.container);
  });

  it("mounts every section through the slot an outside Uplink would use", () => {
    // The whole of the self-contribution claim. If any section were drawn by
    // the host directly it would not be here, and the slot could be inadequate
    // without anything failing.
    //
    // The ORDER is asserted too, and the two editor sections lead on purpose:
    // they are about the craft being designed right now, and the three lists
    // below them are about craft already committed to. Tooling follows the cost
    // it breaks down, because the untooled line on that breakdown is the figure
    // it accounts for.
    const ids = getAugmentsForSlot(VEHICLE_ASSEMBLY_SECTIONS).map((a) => a.id);
    expect(ids).toEqual([
      "rp1-vehicle-assembly-build-cost",
      "rp1-vehicle-assembly-tooling",
      "rp1-vehicle-assembly-warehouse",
      "rp1-vehicle-assembly-building",
      "rp1-vehicle-assembly-buildable",
    ]);
  });

  it("says nothing at all when the centre simply holds no vehicles", async () => {
    // An empty centre is not news. This used to draw "None built and none on
    // order", which the widget said about itself rather than about the career.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", []);
    });

    /* Waits for the no-reading line to CLEAR rather than for the panel title,
       which renders before any payload lands: the widget correctly says it has
       no reading until the channels arrive, so a title-based wait passes while
       the data is still absent and asserts against the wrong frame. */
    await waitFor(() => {
      expect(screen.queryByText(/No reading/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/None built/i)).not.toBeInTheDocument();
    expect(screen.queryByText("IN THE WAREHOUSE")).not.toBeInTheDocument();
    expect(screen.queryByText("UNDER INTEGRATION")).not.toBeInTheDocument();
  });

  it("DOES say so when the build queue was never reported, which is a different state", async () => {
    /* The distinction the old message claimed to make and could not: it fired
       on `built.length === 0 && building.length === 0`, and `warehouse ?? []`
       turned an absent payload into an empty array one line above, so a centre
       with nothing built and an Uplink saying nothing reached the same
       sentence. Emitting NEITHER channel is what "not reporting" looks like. */
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
    });

    await waitFor(() => {
      expect(
        screen.getByText("No reading from the build queue."),
      ).toBeInTheDocument();
    });
  });

  it("draws every craft across every complex in one flat list", async () => {
    // The state the widget exists for, and the one no per-complex view can
    // show: work in flight at two complexes at once.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [...COMPLEXES, LC2]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", [
        integrating({
          id: "vp-vanguard-1",
          lcId: "lc-2",
          shipId: "ship-vanguard-1",
          shipName: "Vanguard",
        }),
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("Atlas")).toBeInTheDocument();
    });
    expect(screen.getByText("Vanguard")).toBeInTheDocument();
    expect(visibleText()).toContain("LC-1 · costs");
    expect(visibleText()).toContain("LC-2 · costs");
  });

  it("says what a launch complex is and which space centre it stands at", async () => {
    // The operator's own question about these renders: "I'm still so lost on
    // what Cape is. Is that the Space Center? A KSC? And LC-1 and LC-2 are
    // seemingly complexes within Cape?" Nothing on the wire says one contains
    // the other, and a card tagged LC-1 cannot say it on its own, so the
    // widget states it once at the top and every tag below stays a tag.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [...COMPLEXES, LC2]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(visibleText()).toContain("Launch complexes: LC-1, LC-2 at Cape");
    });
  });

  it("gathers the complexes under the centre each one stands at", async () => {
    /*
     * Two centres is what makes the sentence do work rather than read as a
     * list: RP-1 supports several through KSCSwitcher, and a flat "LC-1, LC-2,
     * LC-3" would say nothing about which card belongs where.
     */
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        ...COMPLEXES,
        LC2,
        { ...LC2, kscName: "Vandenberg", lcId: "lc-3", name: "SLC-3" },
      ]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(visibleText()).toContain(
        "LC-1, LC-2 at Cape; SLC-3 at Vandenberg",
      );
    });
  });

  it("says nothing about the hierarchy before RP-1 has named a complex", async () => {
    // A heading over nothing says less than no heading, and this line is only
    // worth drawing when there is a tag below it to match.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", []);
      fixture.emit("rp1.pads", []);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", []);
    });

    /* Waits for the no-reading line to clear, which is what says the channels
       have landed. This used to wait for "None built and none on order", using
       a message about emptiness as a settle-signal for a test whose subject is
       the hierarchy heading. */
    await waitFor(() => {
      expect(screen.queryByText(/No reading/i)).not.toBeInTheDocument();
    });
    expect(visibleText()).not.toContain("Launch complexes:");
  });

  it("names the complex even where the centre has only one of them", async () => {
    // Unlike the Space Center section this replaced, which suppressed it. Here
    // the complex is what a flat multi-complex list is grouped BY, and a card
    // that names it only sometimes cannot be scanned for it.
    await withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    // On the card's own detail line rather than appended to the name: the name
    // is the heading of a card and reads as one.
    expect(visibleText()).toContain("Atlas");
    expect(visibleText()).toContain("LC-1 · costs");
  });

  it("says why the clock reads what it reads, on every card", async () => {
    /*
     * Staffing is a RATE control: RP-1 scales a complex's work by the portion
     * of its engineer places filled, so this is the answer to "why is this
     * taking so long" and belongs beside the ETA rather than only on the
     * staffing screen.
     */
    await withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("18 / 60 engineers");
  });

  it("marks EVERY card at a rushing complex, the rollout included", async () => {
    // RP-1's rush multiplier is applied to a complex's rollouts and rollbacks
    // as well as its integrations, which its own tooltip does not say. A status
    // drawn only on an integrating card would repeat that mistake.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [{ ...COMPLEXES[0], isRushing: true }]);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollout" }]);
      fixture.emit("rp1.operations", [operation()]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await waitFor(() => {
      expect(screen.getByText("ROLLING OUT")).toBeInTheDocument();
    });
    expect(screen.getByText("INTEGRATING")).toBeInTheDocument();
    // Two cards, two badges. One would mean the rollout card had been left out.
    expect(screen.getAllByText("RUSHING")).toHaveLength(2);
  });

  it("says a stalled build has nobody on it rather than leaving it a mystery", async () => {
    // The two stalls an operator does different things about. This one is
    // fixed from the Space Center in a minute; the other needs finding out
    // about first.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [{ ...COMPLEXES[0], engineers: 0 }]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", [
        integrating({ stalled: true, timeLeftSeconds: null }),
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("nobody is assigned to LC-1");
    expect(visibleText()).toContain("0 / 60 engineers");
  });

  it("does not call a stall a staffing problem when the complex is staffed", async () => {
    /*
     * The other half, and the reason the two are separate sentences: sending an
     * operator to a staffing screen that already reads full is worse than
     * saying nothing.
     */
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", [
        integrating({ stalled: true, timeLeftSeconds: null }),
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(visibleText()).toContain(
      "Integration is stalled and has no end date",
    );
    expect(visibleText()).not.toContain("nobody is assigned");
  });

  it("reads an unanswered engineer count as unknown rather than as nobody", async () => {
    /*
     * RP-1 not answering is not RP-1 saying nobody is assigned, and printing
     * the fixable sentence for it sends an operator somewhere with nothing to
     * fix.
     */
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        { isOperational: true, kscName: "Cape", lcId: "lc-1", name: "LC-1" },
      ]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", [
        integrating({ stalled: true, timeLeftSeconds: null }),
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(visibleText()).not.toContain("nobody is assigned");
  });

  it("offers no way to start a build at all, rather than only the copy", async () => {
    // The one build command RP-1 exposes COPIES a design the centre already
    // holds. A control for it can order a second Atlas and can never order a
    // first one, so it read as the general case while doing the special one:
    // an operator was offered "Build another Atlas" and had no way anywhere to
    // order the Atlas. An honest absence is the answer until a start command
    // exists.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    expect(
      screen.queryByRole("button", { name: /[Bb]uild/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/[Rr]epeat/)).not.toBeInTheDocument();
  });

  it("never dispatches the repeat command, however the widget is driven", async () => {
    // The command stays live on the mod side and this widget stays silent on
    // it. Asserted on the WIRE rather than on the absence of a button, because
    // those are different claims and the one that matters is that nothing here
    // can spend by that route.
    const { fixture } = await withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(
      fixture.transport.sentCommands.some(
        (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
      ),
    ).toBe(false);
  });

  it("says a vehicle RP-1 gave no id to cannot be commanded, rather than offering to guess", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    /*
     * EVERY control: none of them can name a target without the id, and
     * guessing from the name would pick the wrong one of two vehicles that
     * share it.
     */
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("rolls a built vehicle out to the pad, after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = await withOneBuiltVehicle();

    // One free pad, so one button, and it still reads "Roll out" rather than
    // repeating a name the operator has no choice about.
    const control = await screen.findByRole("button", {
      name: "Roll Atlas · LC-1 out to LaunchPad",
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
        name: "Confirm rolling Atlas · LC-1 out to LaunchPad",
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

  it("prices the rollout beside the press, over the move and never as a verdict", async () => {
    const { view } = await withOneBuiltVehicle();

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Roll Atlas · LC-1 out to LaunchPad",
        }),
      ).toBeInTheDocument();
    });

    const text = (view.container.textContent ?? "").replace(/\s+/g, " ");
    // RP-1's own figure for THIS vehicle, and the three words that say how it is
    // taken: nothing at the press, drawn down as the vehicle moves.
    expect(text).toContain("over the rollout");
    expect(text).toMatch(/4,?000.*over the rollout/);

    /*
     * The one reading that must never appear. RP-1 bills a rollout the way it
     * bills a construction, so a career short of funds gets a SLOWER move rather
     * than a refusal, and an affordability verdict here would describe something
     * the game does not do. The confirm says COMMIT for the same reason.
     */
    expect(text).not.toMatch(/afford/i);
    expect(
      screen.getByRole("button", {
        name: "Roll Atlas · LC-1 out to LaunchPad",
      }),
    ).toBeEnabled();
  });

  it("prices a resumed rollout at what is LEFT, not at the whole move", async () => {
    const { fixture, view } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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

    // The move is a fifth done and RP-1 has already drawn that fifth down, so
    // turning it round bills the rest. Quoting the vehicle's full 4,000 would
    // overstate the press by everything the first attempt paid.
    const text = (view.container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/3,?200.*over the rollout/);
    expect(text).not.toMatch(/4,?000.*over the rollout/);
  });

  it("still offers the press when RP-1 has not priced the move", async () => {
    // Absent is not free, and it is not a reason to withhold a control either:
    // the command reads the price itself, so the worst case is a refusal one
    // step later against the certainty of hiding a press that would have worked.
    const { fixture, view } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built({ rolloutCost: undefined })]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Roll Atlas · LC-1 out to LaunchPad",
        }),
      ).toBeEnabled();
    });
    expect(view.container.textContent).toContain(
      "RP-1 has not priced this rollout",
    );
  });

  it("makes the operator choose when the complex has more than one free pad", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [
        ...PADS,
        {
          hasVesselWaiting: false,
          kscName: "Cape",
          launchSiteName: "LaunchPad 2",
          lcId: "lc-1",
          name: "LaunchPad 2",
          padId: "pad-2",
          state: "Free",
        },
      ]);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    /*
     * The choice is made HERE, where the names are visible, rather than as a
     * refusal the operator has to read and retry: RP-1 asks with a popup and
     * there is nobody to answer a popup from another machine.
     */
    await user.click(
      await screen.findByRole("button", {
        name: "Roll Atlas · LC-1 out to LaunchPad 2",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm rolling Atlas · LC-1 out to LaunchPad 2",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLOUT_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1", pad: "LaunchPad 2" });
  });

  it("shows a vehicle on its way to the pad and offers only the way back", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    // The operation OUTRANKS the list: the vehicle is still in the warehouse,
    // so "BUILT" would be true and would tell an operator nothing they need.
    expect(screen.queryByText("BUILT")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Roll Atlas · LC-1 back off the pad",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas · LC-1 out/ }),
    ).not.toBeInTheDocument();
    // RP-1 refuses a scrap for a vehicle mid-move, so offering one would be
    // offering a press that can only be refused.
    expect(
      screen.queryByRole("button", { name: /^Scrap/ }),
    ).not.toBeInTheDocument();
  });

  it("says a completed rollout is AT PAD rather than still rolling out", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    // Still reversible, and that is RP-1's own rule: a rolled-out vehicle can
    // be rolled back until it launches.
    expect(
      screen.getByRole("button", {
        name: "Roll Atlas · LC-1 back off the pad",
      }),
    ).toBeInTheDocument();
  });

  it("dispatches the rollback with the vehicle id", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Rollout" }]);
      fixture.emit("rp1.operations", [operation()]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Roll Atlas · LC-1 back off the pad",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm rolling Atlas · LC-1 back off the pad",
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
    await rp1IsPresent(fixture);
    act(() => {
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
        name: "Send Atlas · LC-1 back out to the pad",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm sending Atlas · LC-1 back out to the pad",
      }),
    );

    // The SAME command as a fresh rollout, because the mod reverses the
    // existing operation rather than starting a second one. That is what keeps
    // rollout a direction rather than a toggle.
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_ROLLOUT_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas · LC-1 back/ }),
    ).not.toBeInTheDocument();
  });

  it("does not attach another vehicle's rollout to this card", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", [{ ...PADS[0], state: "Reconditioning" }]);
      // Reconditioning belongs to a PAD and carries no vehicle, so RP-1 stamps
      // it with the pad's id. A card that matched it would report a pad's
      // maintenance as a vehicle moving.
      fixture.emit("rp1.operations", [
        operation({ associatedVesselId: null, type: "Reconditioning" }),
      ]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    /*
     * No offerable pad, so a SENTENCE rather than a button that could only be
     * refused, and it says which of four things is wrong: repair it, build it,
     * wait for reconditioning, or move the vehicle already there.
     */
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas · LC-1 out/ }),
    ).not.toBeInTheDocument();
    expect(visibleText()).toContain("reconditioned");
  });

  it("scraps a vehicle for its refund, after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = await withOneBuiltVehicle();

    await user.click(
      await screen.findByRole("button", { name: "Scrap Atlas · LC-1" }),
    );
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_SCRAP_COMMAND,
      ),
    ).toBeUndefined();
    /*
     * The confirm says what comes BACK, because that is the fact an operator
     * weighs: RP-1 refunds the vehicle in full and the loss is the integration
     * time, which no number on this card can show.
     */
    expect(visibleText()).toContain("Refund");

    await user.click(
      screen.getByRole("button", { name: "Confirm scrapping Atlas · LC-1" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_SCRAP_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("scraps a vehicle that is still integrating, which is how a queue gets corrected", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await user.click(
      await screen.findByRole("button", { name: "Scrap Atlas · LC-1" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm scrapping Atlas · LC-1" }),
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

  it("administers nothing: every complex control stays in the Space Center", async () => {
    // The settled division, and the half of it that is easy to drift back
    // across. The Space Center holds the career's infrastructure and its
    // management, staffing and rushing included; this widget is purely
    // construction and rollout, and shows both of those as read-only status
    // because they are what its clocks are made of.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    // The status is on the card and every control for it is absent: rushing,
    // staffing, the complex's own level and the payroll behind it.
    expect(visibleText()).toContain("18 / 60 engineers");
    expect(screen.queryByRole("button", { name: /[Rr]ush/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /[Aa]ssign/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /[Uu]pgrade/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /[Hh]ire/ })).toBeNull();
    // Every control this widget DOES have acts on one vehicle, never on the
    // complex it stands at.
    expect(screen.getByRole("button", { name: /^Scrap Atlas/ })).toBeTruthy();
  });

  it("gathers a complex's craft together in the list", async () => {
    // What makes a flat list read as grouped by complex without nesting it
    // under headings that would repeat "LC-1 at Cape" once per section per
    // complex. Interleaved on the wire, gathered on screen.
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [...COMPLEXES, LC2]);
      fixture.emit("rp1.pads", PADS);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [
        built({ id: "vp-b", lcId: "lc-2", shipId: "s-b", shipName: "Bravo" }),
        built({ id: "vp-a", shipName: "Alfa" }),
        built({ id: "vp-d", lcId: "lc-2", shipId: "s-d", shipName: "Delta" }),
        built({ id: "vp-c", shipId: "s-c", shipName: "Charlie" }),
      ]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("Delta")).toBeInTheDocument();
    });
    // LC-1 leads because RP-1 lists it first, and within a complex the wire
    // order is kept: RP-1 works a queue in the order it publishes it.
    const cards = screen.getAllByRole("listitem");
    expect(
      ["Alfa", "Charlie", "Bravo", "Delta"].map((name, index) =>
        cards[index]?.textContent?.startsWith(name) === true ? name : "?",
      ),
    ).toEqual(["Alfa", "Charlie", "Bravo", "Delta"]);
  });

  it("stays accessible with every control on screen at once", async () => {
    const { fixture, view } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      /*
       * Free AND occupied at once, which is a real RP-1 state and the reason
       * hasVesselWaiting had to go on the wire: State derives from the pad's
       * OPERATIONS, and a craft already sent to the launch site has none left.
       */
      fixture.emit("rp1.pads", [
        {
          ...PADS[0],
          hasVesselWaiting: true,
          state: "Free",
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
      screen.queryByRole("button", { name: /^Roll Atlas · LC-1 out/ }),
    ).not.toBeInTheDocument();
    // Named, because "the pad is taken" leaves an operator looking and
    // "Vanguard is on it" tells them what to move.
    expect(visibleText()).toContain("Vanguard");
  });

  it("still offers a pad whose occupancy the mod could not determine", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      // Null, not false: the mod could not answer. Treating that as occupied
      // would hide a control that works, and the command re-checks at the
      // press, so the worst case of offering it is a refusal one step later.
      fixture.emit("rp1.pads", [{ ...PADS[0], hasVesselWaiting: null }]);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    expect(
      await screen.findByRole("button", {
        name: "Roll Atlas · LC-1 out to LaunchPad",
      }),
    ).toBeInTheDocument();
  });

  it("quotes RP-1's own reasons when the complex will not release the vehicle", async () => {
    const { fixture } = mount();
    await rp1IsPresent(fixture);
    act(() => {
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
    /*
     * EVERY reason, not just the first: an operator who fixes one and is handed
     * the next has been made to iterate, and RP-1's own popup lists them at
     * once.
     */
    expect(visibleText()).toContain("human-rated");
    // The VEHICLE half outranks the pads: a free pad is on the wire and no
    // rollout is offered, because no pad can take a vehicle its complex will
    // not release. This is a capability limit and not a staffing one, and no
    // number of engineers gets past it.
    expect(
      screen.queryByRole("button", { name: /^Roll Atlas · LC-1 out/ }),
    ).not.toBeInTheDocument();
    // Scrap is still offered. Correcting the queue is exactly what an operator
    // does about a vehicle its complex will never fly.
    expect(
      screen.getByRole("button", { name: "Scrap Atlas · LC-1" }),
    ).toBeInTheDocument();
  });
});
