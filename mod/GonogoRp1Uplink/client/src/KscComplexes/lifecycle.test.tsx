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
 * Demolishing a complex, and the loss RP-1's own dialog does not name.
 *
 * RP-1 asks "This cannot be undone!" and says nothing about what is undone. The
 * answer is the complex's earned build efficiency, and whether it is lost at all
 * depends on something an operator cannot see: whether a sibling complex shares
 * the efficiency record. Those are two different warnings, and the wrong one is
 * worse than none, which is what these tests are about.
 */
describe("dismantling a launch complex", () => {
  it("warns that an unshared crew rating is lost for good", async () => {
    const { view } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    const text = view.container.textContent ?? "";
    expect(text).toContain("LOST for good");
    expect(text).toContain("starts again from the bottom");
    await expectNoA11yViolations(view.container);
  });

  it("says the rating survives when a sibling shares it, which is not a loss", async () => {
    const { view } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: ["lc-2"] },
      { ...LC1, lcId: "lc-2", name: "LC-2" },
    ]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    const text = view.container.textContent ?? "";
    // Named rather than given as an id: the operator is being told the figure is
    // safe somewhere, and "lc-2" is not somewhere.
    expect(text).toContain("survives with LC-2");
    expect(text).not.toContain("LOST for good");
    // And the BUTTON has to agree with the sentence above it. The visible
    // warning and the accessible name are computed from different expressions,
    // so a control that lost the sibling test would tell a screen-reader user the
    // rating is going while the text beside it says it is safe. Found by
    // mutating the sibling test out: every text assertion above still passed.
    expect(
      screen.getByRole("button", { name: "Dismantle LC-1" }),
    ).toBeInTheDocument();
  });

  it("says there is no rating to lose at a complex nobody has built at", async () => {
    /*
     * ABSENT, which is what the wire actually carries: RP-1 creates the efficiency
     * record the first time a complex is worked, so a fresh complex publishes no
     * figure at all. This test used to pass `0` and passed for the wrong reason,
     * because the widget tested for zero and let absent fall into a generic line.
     * A render scene caught it, which is the case FOR renders: the fixture there
     * had to be a realistic payload and this one did not.
     */
    const { view } = withCentre([{ ...LC1, efficiency: undefined }]);

    await waitFor(() => {
      expect(screen.getByText("LC-1")).toBeInTheDocument();
    });
    const text = view.container.textContent ?? "";
    expect(text).toContain("no crew rating to lose");
    expect(text).not.toContain("LOST for good");
  });

  it("takes two presses, because nothing here undoes it", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre([
      { ...LC1, efficiency: 0.62, efficiencySharedWith: [] },
    ]);

    await user.click(
      await screen.findByRole("button", {
        name: "Dismantle LC-1, losing its crew rating for good",
      }),
    );
    // Armed, not sent. Unlike rush and assign beside it, which change a rate and
    // are reversible by pressing again.
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === RP1_COMPLEX_DISMANTLE_COMMAND,
      ),
    ).toHaveLength(0);

    await user.click(
      await screen.findByRole("button", {
        name: "Confirm dismantling LC-1 and losing its crew rating",
      }),
    );
    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_COMPLEX_DISMANTLE_COMMAND,
    );
    expect(sent?.args).toEqual({ lcId: "lc-1" });
  });

  it("offers nothing for the hangar, which RP-1 will never demolish", async () => {
    withCentre([{ ...LC1, lcType: "Hangar", name: "Hangar" }]);

    await waitFor(() => {
      expect(screen.getByText("Hangar")).toBeInTheDocument();
    });
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
  it("sends the complex and the pad, after a confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withCentre();

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
    withCentre([{ ...LC1, launchPadCount: 1 }], [PADS[0]]);

    const button = await screen.findByRole("button", {
      name: "LP-1 is the last working pad at this complex, and a complex must keep one",
    });
    // RP-1's own control is live here and silently inert. A dark control with
    // the reason on it is the difference between an operator who knows to build
    // another pad and one who thinks the mod is broken.
    expect(button).toBeDisabled();
  });

  it("darkens a pad still under construction, and says which act to use instead", async () => {
    withCentre(
      [{ ...LC1, launchPadCount: 1 }],
      [PADS[0], { ...PADS[1], isOperational: false }],
    );

    const button = await screen.findByRole("button", {
      name: "LP-2 is not in service yet, so cancel its construction instead",
    });
    expect(button).toBeDisabled();
    // The row says so too, because the count above it cannot: two pads listed
    // and one operational reads as a contradiction without it.
    expect(screen.getByText(/not in service/)).toBeInTheDocument();
  });
});
