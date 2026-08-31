import {
  act,
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
  RP1_PAD_NEW_COMMAND,
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
  RP1_PAD_NEW_COMMAND,
  "career.status",
];

const CAPE = {
  engineers: 30,
  kscName: "Cape",
  launchComplexCount: 1,
  unassignedEngineers: 6,
};

const LC1 = {
  engineers: 18,
  isOperational: true,
  isRushing: false,
  kscName: "Cape",
  launchPadCount: 2,
  lcId: "lc-1",
  lcType: "Pad",
  massMax: 180,
  maxEngineers: 60,
  name: "LC-1",
  newPadCost: 14_118.31,
};

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
    lcId: "lc-1",
    level: 1,
    name: "LP-2",
    padId: "pad-2",
  },
];

function withCentre(
  complexes: readonly Record<string, unknown>[] = [LC1],
  pads: readonly Record<string, unknown>[] = PADS,
  career: Record<string, unknown> = { economy: { funds: 289_848 } },
) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscComplexes />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", [CAPE]);
    fixture.emit("rp1.complexes", complexes);
    fixture.emit("rp1.pads", pads);
    fixture.emit("career.status", career);
  });
  return { fixture, view };
}

/**
 * Demolishing a complex.
 *
 * <para>The three standing efficiency sentences these tests used to assert are
 * GONE, and their absence is the assertion now. The operator's ruling: "this is
 * meant to be a mission control, not a storybook. We present facts and
 * instrumentation, not guidance", and a permanent explanation of a button nobody
 * has pressed, repeated under every complex in the career, was guidance.</para>
 *
 * <para>What survives is the fact that a crew rating goes at all, in the confirm
 * step's own label, which is where the operator asked for it.</para>
 */
describe("dismantling a launch complex", () => {
  /** Everything below the crew now sits behind one expander. */
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    const triggers = await screen.findAllByRole("button", {
      name: /^Detail for /,
    });
    await user.click(triggers[0]);
  }

  it("says nothing about dismantling until the press", async () => {
    const user = userEvent.setup();
    const { view } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    // Not on the card at any point before a press, which is the operator's ruling.
    expect(view.container.textContent).not.toContain("crew rating");
    expect(view.container.textContent).not.toContain("LOST");

    await openDetail(user);
    // Still nothing: the expander reveals the CONTROL, not an essay about it.
    expect(view.container.textContent).not.toContain("crew rating");
  });

  it("carries the whole warning on the confirm step, in the operator's words", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await openDetail(user);
    await user.click(
      await screen.findByRole("button", { name: "Dismantle LC-1" }),
    );

    // Armed, not sent, and the warning appears only now.
    expect(
      await screen.findByText("Warning: removes complex, pads and crew rating"),
    ).toBeInTheDocument();
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === RP1_COMPLEX_DISMANTLE_COMMAND,
      ),
    ).toHaveLength(0);
  });

  it("takes two presses, because nothing here undoes it", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await openDetail(user);
    await user.click(
      await screen.findByRole("button", { name: "Dismantle LC-1" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Confirm dismantling LC-1/,
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_COMPLEX_DISMANTLE_COMMAND,
    );
    expect(sent?.args).toEqual({ lcId: "lc-1" });
  });

  it("offers nothing for the hangar, which RP-1 will never demolish", async () => {
    const user = userEvent.setup();
    withCentre([{ ...LC1, lcType: "Hangar", name: "Hangar" }]);

    await waitFor(() => {
      expect(screen.getByText("Hangar")).toBeInTheDocument();
    });
    await openDetail(user);
    // A control that could only ever be refused is worse than no control.
    expect(
      screen.queryByRole("button", { name: /Dismantle Hangar/ }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Demolishing one pad, which is the case RP-1 answers by doing nothing at all:
 * its check short-circuits, the confirmation closes, and the pad is still there.
 */
describe("dismantling a launch pad", () => {
  /** The pad rows moved behind the complex's detail expander with everything else. */
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    const triggers = await screen.findAllByRole("button", {
      name: /^Detail for /,
    });
    await user.click(triggers[0]);
  }

  it("sends the complex and the pad, after a confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

    await openDetail(user);
    await user.click(
      await screen.findByRole("button", {
        name: "Dismantle LP-1, permanently",
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm dismantling LP-1" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_PAD_DISMANTLE_COMMAND,
    );
    // The pad by ID, not by name: a rename moves the name and RP-1 stores its
    // rollouts against it, so the id is the only stable address.
    expect(sent?.args).toEqual({ lcId: "lc-1", padId: "pad-1" });
  });

  it("darkens the last working pad with the reason, rather than letting the press do nothing", async () => {
    const user = userEvent.setup();
    withCentre([{ ...LC1, launchPadCount: 1 }], [PADS[0]]);
    await openDetail(user);

    const button = await screen.findByRole("button", {
      name: "LP-1 is the last working pad at this complex, and a complex must keep one",
    });
    // RP-1's own control is live here and silently inert. A dark control with
    // the reason on it is the difference between an operator who knows to build
    // another pad and one who thinks the mod is broken.
    expect(button).toBeDisabled();
  });

  it("darkens a pad still under construction, and says which act to use instead", async () => {
    const user = userEvent.setup();
    withCentre(
      [{ ...LC1, launchPadCount: 1 }],
      [PADS[0], { ...PADS[1], isOperational: false }],
    );
    await openDetail(user);

    const button = await screen.findByRole("button", {
      name: "LP-2 is not in service yet, so cancel its construction instead",
    });
    expect(button).toBeDisabled();
    // The row says so too, because the count above it cannot: two pads listed
    // and one operational reads as a contradiction without it.
    expect(screen.getByText(/not in service/)).toBeInTheDocument();
  });
});

/**
 * Adding a pad.
 *
 * <para>The command has been on the wire since the lifecycle work landed and had
 * no control at all, which is the gap the operator found by asking why they could
 * not add one. What the control has to get right is not the dispatch, which is two
 * fields: it is the PRICE, and what the price means.</para>
 *
 * <para>RP-1 does not take the money at the press. It draws a construction down as
 * it builds, and a career that cannot afford a tick gets a slower build rather than
 * a refusal, so "more than the balance" is a fact about pace and the control says it
 * as one. A control that said "cannot afford" would be describing a refusal RP-1
 * does not make.</para>
 */
describe("adding a launch pad", () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    const triggers = await screen.findAllByRole("button", {
      name: /^Detail for /,
    });
    await user.click(triggers[0]);
  }

  it("quotes the price and sends the name that was typed", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();
    await openDetail(user);

    /*
     * The price is the complex's own, published rather than derived: the curve has
     * a second term above 350 t and a human-rating multiplier, and a TypeScript
     * copy would agree with the copy rather than with RP-1.
     */
    expect(screen.getByText(/14,118/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("New pad at LC-1"), "LP-3");
    await user.click(
      screen.getByRole("button", { name: /^Build LP-3 at LC-1/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Confirm building LP-3/ }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_PAD_NEW_COMMAND,
    );
    expect(sent?.args).toEqual({ lcId: "lc-1", name: "LP-3" });
  });

  it("will not send a name a pad here already has", async () => {
    const user = userEvent.setup();
    withCentre();
    await openDetail(user);

    // RP-1 refuses a duplicate by name, so the control refuses first rather than
    // dispatching something that comes back refused.
    await user.type(screen.getByLabelText("New pad at LC-1"), "LP-2");

    expect(
      screen.getByText("a pad at this complex already has that name"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Build LP-2 at LC-1/ }),
    ).toBeDisabled();
  });

  it("refuses an unnamed pad without saying the name is wrong", async () => {
    const user = userEvent.setup();
    withCentre();
    await openDetail(user);

    // Dark, and the label says what to do rather than what went wrong: nothing has
    // gone wrong yet, the operator simply has not typed a name.
    expect(
      screen.getByRole("button", { name: "Name the pad before building it" }),
    ).toBeDisabled();
  });

  it("calls a shortfall a slower build, not a refusal", async () => {
    const user = userEvent.setup();
    withCentre([LC1], PADS, { economy: { funds: 400 } });
    await openDetail(user);

    // The whole point of the IL read: AddProgress spends the affordable FRACTION,
    // advances by that fraction, stops timewarp and carries on. No cancel, no
    // refund. So the press is still live.
    expect(
      screen.getByText(/more than the balance, so it builds slower/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("New pad at LC-1"), "LP-3");
    expect(
      screen.getByRole("button", { name: /^Build LP-3 at LC-1/ }),
    ).toBeEnabled();
  });

  it("draws no control when RP-1 would not price a pad", async () => {
    const user = userEvent.setup();
    // Absent is not free. A hangar has no pad, and RP-1 declines to price one in
    // other cases too; both must draw nothing rather than a quote of zero.
    withCentre([{ ...LC1, newPadCost: undefined }]);
    await openDetail(user);

    expect(screen.queryByLabelText("New pad at LC-1")).not.toBeInTheDocument();
    expect(screen.queryByText(/0\s*f\b/)).not.toBeInTheDocument();
  });

  it("offers a pad to a complex that has none, which is where it matters most", async () => {
    const user = userEvent.setup();
    withCentre([{ ...LC1, launchPadCount: 0 }], []);
    await openDetail(user);

    // A pad complex with no pad cannot launch anything, so this is the state the
    // control is most needed in and the one an early return would have skipped.
    expect(screen.getByText("no pads")).toBeInTheDocument();
    expect(screen.getByLabelText("New pad at LC-1")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const user = userEvent.setup();
    const { view } = withCentre();
    await openDetail(user);
    await expectNoA11yViolations(view.container);
  });
});
