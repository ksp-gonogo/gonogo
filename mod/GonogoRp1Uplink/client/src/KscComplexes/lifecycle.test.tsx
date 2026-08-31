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
