import {
  act,
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  RP1_WARP_TO_COMPLETE_COMMAND,
  RP1_WARP_TO_FUND_TARGET_COMMAND,
  WarpTargets,
} from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.fundTarget",
  RP1_WARP_TO_COMPLETE_COMMAND,
  RP1_WARP_TO_FUND_TARGET_COMMAND,
];

function mount(fundTarget?: Record<string, unknown>) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <WarpTargets />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("rp1.available", true);
    if (fundTarget !== undefined) {
      fixture.emit("rp1.fundTarget", fundTarget);
    }
  });
  return { fixture, view };
}

describe("WarpTargets", () => {
  it("binds the slot the host widget already has for a mod's warp target", () => {
    /*
     * An augment rather than a widget, and the assertion is that it LANDS in the
     * slot rather than merely rendering: warping is one act with one piece of
     * state, and a second panel owning the mod's version would make an operator
     * hunt for whichever one RP-1 respects.
     */
    const augments = getAugmentsForSlot("warp-control.stepper");
    expect(augments.map((a) => a.id)).toContain("rp1-warp-targets");
  });

  it("renders nothing at all until RP-1 says it is there", async () => {
    const fixture = setupStreamFixture({ carriedChannels: TOPICS });
    const view = render(
      <fixture.Provider>
        <WarpTargets />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("rp1.available", false);
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });

  it('names what it warps to rather than saying only "next"', async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();

    await user.click(
      await screen.findByRole("button", {
        name: "Warp until RP-1's next project finishes",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_WARP_TO_COMPLETE_COMMAND,
    );
    // No arguments at all: RP-1 holds exactly one next-thing-to-finish, so a
    // command carrying an id would imply a roster that does not exist.
    expect(sent?.args).toEqual({});
    await expectNoA11yViolations(view.container);
  });

  it("darkens the fund-target press when no target is standing, and says nothing else", async () => {
    const { view } = mount({ active: false });

    const button = await screen.findByRole("button", {
      name: "No fund target is standing, so there is no balance to warp toward",
    });
    expect(button).toBeDisabled();
    /*
     * The subtitle is GONE and its absence is the assertion. The operator ruled
     * that funds "needs LESS", so the reason a press is dark lives in its
     * accessible name, where a screen reader still gets it and the panel spends
     * no space on it.
     */
    expect(view.container.textContent).not.toContain("no fund target set");
  });

  it("warps to the fund target, and the press says what it warps to", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount({ active: true, timeLeft: 864000 });

    // The label names the target, on the operator's ruling. "warp to funds" was
    // the earlier wording and said less.
    await user.click(
      await screen.findByRole("button", {
        name: "Warp until the balance reaches the fund target",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_WARP_TO_FUND_TARGET_COMMAND,
      )?.args,
    ).toEqual({});
    expect(screen.getByText("fund target")).toBeInTheDocument();
    // No ETA line: the operator asked for less here, not more.
    expect(view.container.textContent).not.toContain("fund target in");
  });

  it("offers no way to stop warping, because the host widget already does", async () => {
    mount({ active: true, timeLeft: 864000 });

    await waitFor(() => {
      expect(screen.getByText(/next completion/)).toBeInTheDocument();
    });
    /*
     * RP-1's controller destroys itself the moment it sees a warp rate of zero,
     * so the host's own "1x" button ends an RP-1 warp. A second stop control
     * would be two buttons doing one thing with the operator left to guess which
     * one the mod respects.
     */
    expect(
      screen.queryByRole("button", { name: /[Ss]top/ }),
    ).not.toBeInTheDocument();
  });
});
